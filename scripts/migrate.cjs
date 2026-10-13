const fs = require("node:fs/promises")
const path = require("node:path")
const { createHash } = require("node:crypto")
const directory = path.resolve(__dirname, "../migrations")
const hash = value => createHash("sha256").update(value).digest("hex")
class ValidationError extends Error {}
const fail = message => { throw new ValidationError(message) }
const safeError = error => {
    const primary = error instanceof ValidationError ? error.message : "PostgreSQL or filesystem operation failed; sensitive details suppressed"
    return primary + (error?.cleanupFailures?.length ? `; cleanup failed: ${error.cleanupFailures.join(", ")} (details suppressed)` : "")
}
function cleanupFailure(primary, stage) {
    const error = primary instanceof ValidationError ? primary : new Error("PostgreSQL operation failed; sensitive details suppressed")
    error.cleanupFailures = [...(primary?.cleanupFailures ?? []), stage]
    return error
}
async function loadPolicy() {
    try { return JSON.parse(await fs.readFile(path.join(__dirname, "migration-targets.json"), "utf8")) }
    catch { fail("Approved migration target registry is unavailable or invalid") }
}

async function readPlan(migrationsDirectory = directory) {
    const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true })
    const files = []
    const versions = new Set()
    for (const entry of entries) {
        if (!/\.sql$/i.test(entry.name)) continue
        const match = /^(\d{12})_[a-z_]+\.sql$/.exec(entry.name)
        if (!match || !entry.isFile()) fail("Invalid SQL migration filename or file type; expected 12 digits_name.sql (lowercase)")
        if (versions.has(match[1])) fail("Duplicate SQL migration version")
        versions.add(match[1])
        files.push(entry.name)
    }
    files.sort()
    if (!files.length) fail("Migration manifest is empty")
    return Promise.all(files.map(async version => {
        const sql = (await fs.readFile(path.join(migrationsDirectory, version), "utf8")).replace(/\r\n/g, "\n")
        return { version, sql, checksum: hash(sql) }
    }))
}

function options(args) {
    const result = {}
    for (let i = 0; i < args.length; i++) {
        const key = args[i]
        if (!["--env", "--plan", "--approval", "--expires"].includes(key) || key in result) fail("Invalid or duplicate migration option")
        if (key === "--plan") result[key] = true
        else {
            const value = args[++i]
            if (!value || value.startsWith("--")) fail("Missing migration option value")
            result[key] = value
        }
    }
    if (!["development", "test", "production"].includes(result["--env"])) fail("Explicit --env development|test|production is required")
    return result
}

function parseDestination(connectionString) {
    let url
    try { url = new URL(connectionString) } catch { fail("Invalid database connection configuration") }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || !url.port || !url.pathname.slice(1) || url.hash) fail("Database URL requires explicit host, port, database, user and password")
    const params = [...url.searchParams.keys()]
    if (params.some(key => key !== "sslmode") || params.length > 1) fail("Unsupported database connection parameters (including schema/role overrides)")
    let host, database, user, password
    try {
        host = decodeURIComponent(url.hostname).replace(/^\[|\]$/g, "").toLowerCase()
        database = decodeURIComponent(url.pathname.slice(1))
        user = decodeURIComponent(url.username)
        password = decodeURIComponent(url.password)
    } catch { fail("Invalid database URL encoding") }
    if (!/^[a-z0-9.:-]+$/.test(host) || /[\x00-\x20/\\]/.test(database + user) || !database || !user) fail("Ambiguous database identity")
    const local = ["localhost", "127.0.0.1", "::1"].includes(host)
    const sslmode = url.searchParams.get("sslmode")
    if ((!local && sslmode !== "verify-full") || (sslmode && !["disable", "verify-full"].includes(sslmode))) fail("Remote destinations require sslmode=verify-full; unsupported TLS mode")
    const identity = [host, url.port, database]
    return {
        fingerprint: hash(JSON.stringify([...identity, user])),
        databaseFingerprint: hash(JSON.stringify(identity)),
        config: { host, port: Number(url.port), database, user, password,
            ssl: sslmode === "verify-full" ? { rejectUnauthorized: true } : false,
            options: "-c search_path=public", application_name: "legumex-migrations", connectionTimeoutMillis: 10000,
            client_encoding: "UTF8", sslnegotiation: "postgres", replication: false },
    }
}

function destination(environment, env, policy) {
    if (Object.keys(env).some(key => /^PG/i.test(key))) fail("PG* variables are forbidden for migration execution")
    const prefix = { development: "DEV", test: "TEST", production: "PROD" }[environment]
    const connectionString = env[`${prefix}_DATABASE_URL`]
    if (!connectionString) fail(`Missing ${prefix}_DATABASE_URL; no connection fallback is permitted`)
    const target = parseDestination(connectionString)
    if (environment === "production" && target.config.ssl === false) fail("Production destinations always require verified TLS")
    if (env.DATABASE_CA_CERT) {
        if (!target.config.ssl || !env.DATABASE_CA_CERT.includes("-----BEGIN CERTIFICATE-----")) fail("Database CA requires verified TLS and a PEM certificate")
        target.config.ssl.ca = env.DATABASE_CA_CERT
    }
    const authorized = env[`${prefix}_MIGRATION_TARGET_SHA256`]
    if (authorized !== target.fingerprint) fail("Database destination is not explicitly authorized")
    if (!policy || !Array.isArray(policy.productionDatabases) || !policy.productionDatabases.length || !Array.isArray(policy.targets)
        || policy.productionDatabases.some(value => !/^[a-f0-9]{64}$/.test(value))) fail("Reviewed production inventory and migration target registry are required")
    const production = new Set(policy.productionDatabases)
    // DATABASE_URL is conservatively treated as a possible production identifier, never as a fallback.
    for (const key of ["PROD_DATABASE_URL", "DATABASE_URL"]) {
        if (env[key]) production.add(parseDestination(env[key]).databaseFingerprint)
    }
    if (env.PROD_MIGRATION_TARGET_SHA256 === target.fingerprint && environment !== "production") fail("Nonproduction target contradicts production authorization")
    if (environment !== "production" && production.has(target.databaseFingerprint)) fail("Production database cannot be used in development or test, even with another role")
    const matches = policy.targets.filter(row => row.fingerprint === target.fingerprint)
    if (matches.length !== 1 || matches[0].environment !== environment || matches[0].databaseFingerprint !== target.databaseFingerprint
        || matches[0].isolatedCredentialsVerified !== true) fail("Target lacks an independently reviewed environment and credential isolation record")
    if (environment === "production" && !policy.productionDatabases.includes(target.databaseFingerprint)) fail("Production destination is absent from reviewed inventory")
    return target
}

function approvalDigest(target, plan, expires, operation = "migration", artifact = "") {
    return hash(JSON.stringify([`LEGUMEX production ${operation}`, target, plan.map(({ version, checksum }) => [version, checksum]), expires, ...(artifact ? [artifact] : [])]))
}

// One transaction per version. The lock also serializes separate deployment processes.
async function migrate(client, plan) {
    plan ??= await readPlan()
    await client.query("SET lock_timeout = '5s'")
    await client.query("SET statement_timeout = '60s'")
    await client.query("SELECT pg_advisory_lock(174226, 1)")
    let failure
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY, checksum TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`)
        const history = await client.query("SELECT version, checksum FROM schema_migrations ORDER BY version")
        if (plan[0]?.version === "202610110001_initial_schema.sql" && !history.rows.length) {
            const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'")
            if (existing.rows.length) fail("Initial schema requires an empty public schema; use an explicitly approved new database")
        }
        let gap = false
        for (const item of plan) {
            const recorded = history.rows.find(row => row.version === item.version)
            if (!recorded) gap = true
            else {
                if (gap) fail("Applied migration history is not a prefix of the manifest")
                if (recorded.checksum !== item.checksum) fail("Applied migration checksum mismatch")
            }
        }
        if (history.rows.some(row => !plan.some(item => item.version === row.version))) fail("Database contains migrations absent from the manifest")
        for (const { version, sql, checksum } of plan) {
            // History and checksums were validated under this same exclusive lock.
            if (history.rows.some(row => row.version === version)) continue
            await client.query("BEGIN")
            try {
                await client.query(sql)
                await client.query("INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)", [version, checksum])
                await client.query("COMMIT")
            } catch (error) {
                try { await client.query("ROLLBACK") }
                catch { throw cleanupFailure(error, "rollback") }
                throw error
            }
        }
    } catch (error) {
        failure = error
    } finally {
        try { await client.query("SELECT pg_advisory_unlock(174226, 1)") }
        catch { failure = cleanupFailure(failure, "advisory unlock") }
    }
    if (failure) throw failure
}

async function run(args, env, { createClient = config => new (require("pg").Client)(config), log = console.log, now = Date.now, migrationsDirectory = directory, targetPolicy, administrativeOperation } = {}) {
    const opts = options(args)
    const plan = await readPlan(migrationsDirectory)
    if (administrativeOperation && (!["bootstrap", "rebuild"].includes(administrativeOperation.name) || !/^[a-f0-9]{64}$/.test(administrativeOperation.artifact) || typeof administrativeOperation.execute !== "function")) fail("Invalid administrative operation")
    const confirmation = expires => approvalDigest(target.fingerprint, plan, expires, administrativeOperation?.name, administrativeOperation?.artifact)
    if (opts["--plan"]) {
        if (opts["--approval"]) fail("Approval is not accepted in planning mode")
        if (opts["--env"] !== "production" && opts["--expires"]) fail("--expires has no meaning in development/test plans")
        for (const { version, checksum } of plan) log(`${version} ${checksum}`)
        log("Offline plan only: pending migrations cannot be determined without querying the database.")
        if (opts["--env"] === "production") {
            const target = destination("production", env, targetPolicy ?? await loadPolicy())
            const expires = opts["--expires"]
            validateExpiry(expires, now())
            log(`Target fingerprint: ${target.fingerprint}`)
            log(`Operational confirmation digest (not approver authentication): ${approvalDigest(target.fingerprint, plan, expires, administrativeOperation?.name, administrativeOperation?.artifact)}`)
        }
        return
    }
    if (Object.keys(process.env).some(key => /^PG/i.test(key))) fail("Ambient PG* variables are forbidden for migration execution")
    const target = destination(opts["--env"], env, targetPolicy ?? await loadPolicy())
    if (opts["--env"] === "production") {
        validateExpiry(opts["--expires"], now())
        if (opts["--approval"] !== confirmation(opts["--expires"])) fail("Specific production operational confirmation is required (not approver authentication)")
    } else if (opts["--approval"] || opts["--expires"]) fail("Production approval options require --env production")
    const client = createClient(target.config)
    let clientError = false
    // Never log or rethrow driver error payloads. Keep the listener through end().
    client.on("error", () => { clientError = true })
    let failure
    try {
        await client.connect()
        if (clientError) throw new Error("Client failure")
        if (administrativeOperation) await administrativeOperation.execute(client)
        else await migrate(client, plan)
        if (clientError) throw new Error("Client failure")
    } catch (error) {
        failure = error instanceof ValidationError ? error : new Error("PostgreSQL operation failed; sensitive details suppressed")
        if (error.cleanupFailures) failure.cleanupFailures = error.cleanupFailures
    } finally {
        try { await client.end() } catch { failure = cleanupFailure(failure, "client close") }
    }
    if (failure) throw failure
    if (clientError) throw new Error("PostgreSQL operation failed; sensitive details suppressed")
    log(administrativeOperation ? `Controlled ${administrativeOperation.name} completed` : "Database migrations are up to date")
}

function validateExpiry(expires, now) {
    const time = Date.parse(expires)
    if (!expires || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(expires) || !Number.isFinite(time) || time <= now || time > now + 60 * 60 * 1000) fail("Production approval requires a future UTC expiry within one hour")
}

module.exports = { migrate, run, readPlan, destination, parseDestination, approvalDigest, ValidationError, safeError, loadPolicy }
// Deliberately do not load dotenv: migration secrets must be supplied explicitly.
if (require.main === module) run(process.argv.slice(2), process.env).catch(error => {
    // Driver errors may contain credentials, SQL or connection strings.
    console.error(safeError(error))
    process.exitCode = 1
})
