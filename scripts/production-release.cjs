"use strict"
const fs = require("node:fs/promises")
const path = require("node:path")
const { createHash } = require("node:crypto")
const { createReadStream } = require("node:fs")
const { spawnSync } = require("node:child_process")
const { parseDestination, destination, loadPolicy, run, ValidationError, safeError } = require("./migrate.cjs")
const hash = data => createHash("sha256").update(data).digest("hex")
const fail = message => { throw new ValidationError(message) }
const repository = path.resolve(__dirname, "..")
const sqlFile = path.join(__dirname, "rebuild-public.sql")

function argumentsOf(args) {
    const [action, ...rest] = args
    if (!["identity", "check", "backup", "rebuild"].includes(action)) fail("Use identity, check, backup or rebuild")
    const own = {}, runner = []
    for (let i = 0; i < rest.length; i++) {
        const key = rest[i]
        if (["--backup-dir", "--postgres-bin"].includes(key)) {
            if (own[key] || !rest[i + 1] || rest[i + 1].startsWith("--")) fail("Invalid backup option")
            own[key] = rest[++i]
        } else runner.push(key)
    }
    if (action !== "rebuild" && runner.length) fail("Unexpected production preparation options")
    if (["identity", "check"].includes(action) && Object.keys(own).length) fail("Unexpected backup options")
    if (["backup", "rebuild"].includes(action) && (!own["--backup-dir"] || !own["--postgres-bin"])) fail("Explicit backup directory and PostgreSQL binaries required")
    if (action === "rebuild" && (runner[0] !== "--env" || runner[1] !== "production")) fail("Rebuild requires explicit --env production")
    return { action, own, runner }
}

function identity(env) {
    if (!env.PROD_DATABASE_URL) fail("Supply PROD_DATABASE_URL explicitly; no dotenv/development fallback")
    const t = parseDestination(env.PROD_DATABASE_URL)
    if (t.config.ssl === false) fail("Production requires sslmode=verify-full")
    return { host: t.config.host, port: t.config.port, database: t.config.database, user: t.config.user,
        fingerprint: t.fingerprint, databaseFingerprint: t.databaseFingerprint,
        candidatePolicy: { productionDatabases: [t.databaseFingerprint], targets: [{ environment: "production", fingerprint: t.fingerprint, databaseFingerprint: t.databaseFingerprint, isolatedCredentialsVerified: false }] } }
}

function backupDirectory(value) {
    const resolved = path.resolve(value)
    for (const repo of [repository, path.resolve(repository, "../frontendLegumexStore")]) {
        const relative = path.relative(repo, resolved)
        if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) fail("Backups must remain outside both repositories")
    }
    return resolved
}

function childEnvironment(config) {
    const env = {}
    for (const [key, value] of Object.entries(process.env)) if (["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"].includes(key.toUpperCase())) env[key] = value
    return { ...env, PGHOST: config.host, PGPORT: String(config.port), PGDATABASE: config.database, PGUSER: config.user,
        PGPASSWORD: config.password, PGSSLMODE: "verify-full", PGCONNECT_TIMEOUT: "10", PGAPPNAME: "legumex-release-backup" }
}

function binary(directory, name) { return path.join(path.resolve(directory), name + (process.platform === "win32" ? ".exe" : "")) }
function executeBinary(filename, args, env) {
    const result = spawnSync(filename, args, { env, windowsHide: true, encoding: "utf8", timeout: 600000, maxBuffer: 16 * 1024 * 1024 })
    if (result.error || result.status !== 0) {
        const text = String(result.stderr ?? "")
        const reason = result.error?.code === "ENOENT" ? "binary not found"
            : /server version.*pg_dump version|aborting because of server version mismatch/is.test(text) ? "client/server major version mismatch"
                : /certificate|SSL error|TLS handshake/i.test(text) ? "TLS/certificate verification failed"
                    : /password authentication failed/i.test(text) ? "authentication failed"
                        : /permission denied/i.test(text) ? "insufficient backup/restore privileges" : "utility exited unsuccessfully"
        fail(`PostgreSQL backup utility failed: ${reason}; raw output suppressed, no rebuild authorized`)
    }
    return result.stdout
}

async function archiveInfo(filename) {
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 100) fail("Backup must be a regular, nonempty local archive")
    const digest = createHash("sha256")
    let header = Buffer.alloc(0), bytes = 0
    for await (const chunk of createReadStream(filename)) {
        if (header.length < 5) header = Buffer.concat([header, chunk.subarray(0, 5 - header.length)])
        bytes += chunk.length; digest.update(chunk)
    }
    if (header.toString() !== "PGDMP" || bytes !== stat.size) fail("Backup is malformed or changed while reading")
    return { bytes, sha256: digest.digest("hex") }
}

async function inspect(client, target) {
    const { rows } = await client.query(`SELECT current_database() AS database,current_user AS username,
        (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
        current_setting('server_version_num') AS server_version_num,
        (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables,
        (SELECT count(*)::int FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND left(nspname,3) <> 'pg_') AS custom_schemas,
        (SELECT count(*)::int FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname='public') AS public_extensions,
        (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') AS other_sessions`)
    if (rows.length !== 1 || rows[0].database !== target.config.database || rows[0].username !== target.config.user || rows[0].tls !== true) fail("Live database/user/TLS identity mismatch")
    return rows[0]
}

async function connected(target, operation) {
    const client = new (require("pg").Client)(target.config)
    let failed = false
    client.on("error", () => { failed = true })
    try {
        await client.connect()
        const result = await operation(client)
        if (failed) fail("Production inspection failed; sensitive details suppressed")
        return result
    } finally { await client.end() }
}

async function backup(target, options, env) {
    const directory = backupDirectory(options["--backup-dir"])
    if (await fs.realpath(path.dirname(directory)) !== path.dirname(directory)) fail("Backup parent must be canonical, without junctions or symlinks")
    await fs.mkdir(directory, { mode: 0o700 }) // Existing backup directories are never overwritten.
    const metadata = await connected(target, client => inspect(client, target))
    const filename = path.join(directory, "database.dump")
    const child = childEnvironment(target.config)
    // libpq does not automatically use Node's trust store. Export only public
    // trusted CA certificates, preserving hostname/chain verification for pg_dump.
    child.PGSSLROOTCERT = path.join(directory, "trusted-ca.pem")
    await fs.writeFile(child.PGSSLROOTCERT, env.DATABASE_CA_CERT || require("node:tls").rootCertificates.join("\n"), { flag: "wx", mode: 0o600 })
    executeBinary(binary(options["--postgres-bin"], "pg_dump"), ["--format=custom", "--no-owner", "--no-acl", "--file", filename], child)
    const listing = executeBinary(binary(options["--postgres-bin"], "pg_restore"), ["--list", filename], child)
    if (!listing.includes("; Archive created at") || !listing.includes(";     Format: CUSTOM")) fail("Backup is not a recognized PostgreSQL custom archive")
    const content = await archiveInfo(filename)
    const manifest = { version: 1, fingerprint: target.fingerprint, databaseFingerprint: target.databaseFingerprint,
        database: metadata.database, user: metadata.username, serverVersion: metadata.server_version_num,
        createdAt: new Date().toISOString(), sha256: content.sha256, bytes: content.bytes }
    await fs.writeFile(path.join(directory, "backup-manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 })
    return { backup: filename, backupSha256: manifest.sha256, restoreListingVerified: true }
}

async function rebuildArtifact(directory, target, binaries, now = Date.now()) {
    if (await fs.realpath(directory) !== directory) fail("Backup directory must be canonical, without junctions or symlinks")
    const manifestBytes = await fs.readFile(path.join(directory, "backup-manifest.json"))
    const manifest = JSON.parse(manifestBytes)
    const data = await archiveInfo(path.join(directory, "database.dump"))
    if (manifest.version !== 1 || manifest.fingerprint !== target.fingerprint || manifest.databaseFingerprint !== target.databaseFingerprint
        || manifest.database !== target.config.database || manifest.user !== target.config.user || manifest.sha256 !== data.sha256
        || manifest.bytes !== data.bytes
        || !Number.isFinite(Date.parse(manifest.createdAt)) || Date.parse(manifest.createdAt) > now || now - Date.parse(manifest.createdAt) > 24 * 3600000) fail("Backup proof missing, changed, expired or bound to another destination")
    executeBinary(binary(binaries, "pg_restore"), ["--list", path.join(directory, "database.dump")], childEnvironment(target.config))
    const sql = await fs.readFile(sqlFile, "utf8")
    const seal = await fs.readFile(path.join(repository, "dist/.build-integrity"), "utf8")
    return { sql, digest: hash(JSON.stringify([hash(manifestBytes), manifest.sha256, hash(sql), seal])) }
}

/** Exported for tests against an owned isolated cluster; production CLI always uses TLS/destination/backup/approval guards. */
async function rebuildPublic(client, target, env, sql) {
    if (env.PRODUCTION_WRITES_STOPPED !== "true" || env.REBUILD_CONFIRM_DATABASE !== target.config.database) fail("Explicit write-stop and exact database confirmation required")
    await client.query("BEGIN")
    try {
        await client.query("SET LOCAL lock_timeout='5s'")
        await client.query("SET LOCAL statement_timeout='60s'")
        await client.query("SELECT pg_advisory_xact_lock(174226,1)")
        const status = await inspect(client, target)
        if (status.other_sessions !== 0) fail("Close all other database client sessions before reconstruction; no sessions were terminated")
        const { rows } = await client.query(`SELECT
            (SELECT count(*)::int FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND left(nspname,3) <> 'pg_') AS custom_schemas,
            (SELECT count(*)::int FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname='public') AS public_extensions`)
        if (rows.length !== 1 || rows[0].custom_schemas !== 0 || rows[0].public_extensions !== 0) fail("Custom schemas or public extensions require an explicit separate dependency review")
        await client.query(sql)
        await client.query("COMMIT")
    } catch (error) {
        try { await client.query("ROLLBACK") } catch { fail("Rebuild rollback could not be verified; inspect the destination before continuing") }
        throw error
    }
}

async function main(args, env) {
    const { action, own, runner } = argumentsOf(args)
    if (action === "identity") return identity(env)
    const target = destination("production", env, await loadPolicy())
    if (action === "check") return connected(target, async client => {
        await client.query("BEGIN READ ONLY")
        try { const result = await inspect(client, target); await client.query("COMMIT"); return { fingerprint: target.fingerprint, ...result } }
        catch (error) { await client.query("ROLLBACK"); throw error }
    })
    if (action === "backup") return backup(target, own, env)
    await require("./build-integrity.cjs").run("verify")
    const artifact = await rebuildArtifact(backupDirectory(own["--backup-dir"]), target, own["--postgres-bin"])
    await run(runner, env, { administrativeOperation: { name: "rebuild", artifact: artifact.digest,
        execute: client => rebuildPublic(client, target, env, artifact.sql) } })
    return { operation: runner.includes("--plan") ? "offline-rebuild-plan" : "public-schema-rebuilt", fingerprint: target.fingerprint }
}

module.exports = { main, identity, argumentsOf, backupDirectory, childEnvironment, inspect, rebuildPublic, rebuildArtifact, archiveInfo }
if (require.main === module) main(process.argv.slice(2), process.env).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(safeError(error)); process.exitCode = 1
})
