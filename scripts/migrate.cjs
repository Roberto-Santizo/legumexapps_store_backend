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

function connectableTarget(environment, env, connectionString) {
    if (Object.keys(env).some(key => /^PG/i.test(key))) fail("PG* variables are forbidden for migration execution")
    const target = parseDestination(connectionString)
    if (environment === "production" && target.config.ssl === false) fail("Production destinations always require verified TLS")
    if (env.DATABASE_CA_CERT) {
        if (!target.config.ssl || !env.DATABASE_CA_CERT.includes("-----BEGIN CERTIFICATE-----")) fail("Database CA requires verified TLS and a PEM certificate")
        target.config.ssl.ca = env.DATABASE_CA_CERT
    }
    return target
}

function destination(environment, env, policy) {
    const prefix = { development: "DEV", test: "TEST", production: "PROD" }[environment]
    const connectionString = env[`${prefix}_DATABASE_URL`]
    if (!connectionString) fail(`Missing ${prefix}_DATABASE_URL; no connection fallback is permitted`)
    const target = connectableTarget(environment, env, connectionString)
    const authorized = env[`${prefix}_MIGRATION_TARGET_SHA256`]
    if (authorized !== target.fingerprint) fail("Database destination is not explicitly authorized")
    // DATABASE_URL is conservatively treated as a possible production identifier, never as a fallback.
    return registeredTarget(environment, env, policy, target, ["PROD_DATABASE_URL", "DATABASE_URL"])
}

// The reviewed registry (migration-targets.json) is the destination pin for every mode.
function registeredTarget(environment, env, policy, target, productionUrlKeys) {
    if (!policy || !Array.isArray(policy.productionDatabases) || !policy.productionDatabases.length || !Array.isArray(policy.targets)
        || policy.productionDatabases.some(value => !/^[a-f0-9]{64}$/.test(value))) fail("Reviewed production inventory and migration target registry are required")
    const production = new Set(policy.productionDatabases)
    for (const key of productionUrlKeys) {
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

// Automatic (deploy) mode only continues an existing reviewed history: a new or rebuilt database
// must go through the manual, approved command first.
const DEPLOY_REQUIRED_HISTORY = [
    "202610110001_initial_schema.sql",
    "202610120001_representative_clients.sql",
    "202610120002_packaging_classification.sql",
]
// Mass schema/data deletion is never applied automatically (DROP COLUMN stays allowed).
const DEPLOY_FORBIDDEN_SQL = /\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE|OWNED)|TRUNCATE|DELETE\s+FROM)\b/i

// One transaction per version. The lock also serializes separate deployment processes.
// incrementalOnly: deploy-mode guards. dryRun: read-only session, reports pending versions, writes nothing.
async function migrate(client, plan, { incrementalOnly = false, dryRun = false } = {}) {
    plan ??= await readPlan()
    if (dryRun) await client.query("SET default_transaction_read_only = on")
    await client.query("SET lock_timeout = '5s'")
    await client.query("SET statement_timeout = '60s'")
    await client.query("SELECT pg_advisory_lock(174226, 1)")
    let failure
    const pending = []
    try {
        if (dryRun) {
            const ledger = await client.query("SELECT to_regclass('public.schema_migrations') AS name")
            if (!ledger.rows[0]?.name) fail("Database has no migration history; automatic migrations only continue an existing reviewed history")
        } else await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
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
        pending.push(...plan.filter(item => !history.rows.some(row => row.version === item.version)))
        if (incrementalOnly) {
            if (DEPLOY_REQUIRED_HISTORY.some(version => !history.rows.some(row => row.version === version))) {
                fail("Automatic migrations require the reviewed historical migrations to be recorded; use the manual command for new or rebuilt databases")
            }
            const destructive = pending.find(item => DEPLOY_FORBIDDEN_SQL.test(item.sql))
            if (destructive) fail(`Automatic migrations refuse mass deletion statements (${destructive.version}); apply it with the manual approved command`)
        }
        for (const { version, sql, checksum } of dryRun ? [] : pending) {
            // History and checksums were validated under this same exclusive lock.
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
    return pending.map(item => item.version)
}

async function run(args, env, { createClient = config => new (require("pg").Client)(config), log = console.log, now = Date.now, migrationsDirectory = directory, targetPolicy, administrativeOperation } = {}) {
    const opts = options(args)
    const plan = await readPlan(migrationsDirectory)
    if (administrativeOperation && (administrativeOperation.name !== "bootstrap" || !/^[a-f0-9]{64}$/.test(administrativeOperation.artifact) || typeof administrativeOperation.execute !== "function")) fail("Invalid administrative operation")
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
    await withClient(target, createClient, client => administrativeOperation ? administrativeOperation.execute(client) : migrate(client, plan))
    log(administrativeOperation ? `Controlled ${administrativeOperation.name} completed` : "Database migrations are up to date")
}

async function withClient(target, createClient, work) {
    const client = createClient(target.config)
    let clientError = false
    // Never log or rethrow driver error payloads. Keep the listener through end().
    client.on("error", () => { clientError = true })
    let failure, result
    try {
        await client.connect()
        if (clientError) throw new Error("Client failure")
        result = await work(client)
        if (clientError) throw new Error("Client failure")
    } catch (error) {
        failure = error instanceof ValidationError ? error : new Error("PostgreSQL operation failed; sensitive details suppressed")
        if (error.cleanupFailures) failure.cleanupFailures = error.cleanupFailures
    } finally {
        try { await client.end() } catch { failure = cleanupFailure(failure, "client close") }
    }
    if (failure) throw failure
    if (clientError) throw new Error("PostgreSQL operation failed; sensitive details suppressed")
    return result
}

// Automatic release step (npm start -> prestart -> scripts/release.cjs), approved by the owner on
// 2026-10-14 to replace the per-release production token. It migrates the SAME database the
// application uses (DATABASE_URL + NODE_ENV), pinned by the reviewed registry. Kept from the manual
// command: verified TLS in production, PG* rejection, registry/production-inventory checks, the
// advisory lock, prefix + checksum history checks and one transaction per migration. Added: only
// continues the reviewed history (never creates or rebuilds a schema) and refuses mass deletion.
// dryRun (--deploy-check) runs every check in a read-only session and only reports pending versions.
async function deploy(env, { createClient = config => new (require("pg").Client)(config), log = console.log, migrationsDirectory = directory, targetPolicy, afterMigrate, dryRun = false } = {}) {
    const environment = env.NODE_ENV
    if (!["development", "test", "production"].includes(environment)) fail("NODE_ENV must be development, test or production for automatic migrations")
    if (!env.DATABASE_URL) fail("Missing DATABASE_URL; no connection fallback is permitted")
    if (Object.keys(process.env).some(key => /^PG/i.test(key))) fail("Ambient PG* variables are forbidden for migration execution")
    const plan = await readPlan(migrationsDirectory)
    const target = registeredTarget(environment, env, targetPolicy ?? await loadPolicy(), connectableTarget(environment, env, env.DATABASE_URL), ["PROD_DATABASE_URL"])
    const pending = await withClient(target, createClient, async client => {
        const versions = await migrate(client, plan, { incrementalOnly: true, dryRun })
        if (!dryRun && afterMigrate) await afterMigrate(client)
        return versions
    })
    if (dryRun) log(pending.length ? `Read-only check passed; pending: ${pending.join(", ")}` : "Read-only check passed; no pending migrations")
    else log(pending.length ? `Applied migrations: ${pending.join(", ")}` : "Database migrations are up to date")
    return pending
}

// Registry fingerprints of DATABASE_URL, computed offline; never prints the password.
function identity(env) {
    if (!env.DATABASE_URL) fail("Missing DATABASE_URL")
    const target = parseDestination(env.DATABASE_URL)
    return { host: target.config.host, port: target.config.port, database: target.config.database, user: target.config.user,
        tls: target.config.ssl !== false, fingerprint: target.fingerprint, databaseFingerprint: target.databaseFingerprint }
}

async function cli(args, env) {
    if (args.length === 1 && args[0] === "--identity") return console.log(JSON.stringify(identity(env), null, 2))
    if (args.length === 1 && args[0] === "--deploy-check") return deploy(env, { dryRun: true })
    return run(args, env)
}

function validateExpiry(expires, now) {
    const time = Date.parse(expires)
    if (!expires || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(expires) || !Number.isFinite(time) || time <= now || time > now + 60 * 60 * 1000) fail("Production approval requires a future UTC expiry within one hour")
}

module.exports = { migrate, run, deploy, identity, readPlan, destination, parseDestination, approvalDigest, ValidationError, safeError, loadPolicy, DEPLOY_REQUIRED_HISTORY }
// Deliberately do not load dotenv: migration secrets must be supplied explicitly.
if (require.main === module) cli(process.argv.slice(2), process.env).catch(error => {
    // Driver errors may contain credentials, SQL or connection strings.
    console.error(safeError(error))
    process.exitCode = 1
})
