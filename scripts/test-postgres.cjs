"use strict"

// Owns a newly-created loopback-only cluster. Never accepts a connection URL.
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const net = require("node:net")
const { spawnSync } = require("node:child_process")

const repository = path.resolve(__dirname, "..")
const frontend = path.resolve(repository, "../frontendLegumexStore")
const suites = [
    "src/database/developmentSync.postgres.test.ts",
    "src/database/schemaSync.postgres.test.ts",
    "src/database/bootstrap.postgres.test.ts",
    "src/database/currentSchema.postgres.test.ts",
    "src/features/genericPackaging/services/genericPackaging.postgres.test.ts",
    "src/database/application.postgres.test.ts",
    "src/features/packaging/services/packagingClassification.postgres.test.ts",
    "src/features/salesperson/services/representativeClient.postgres.test.ts",
    "src/features/rawMaterialTransformation/services/rawMaterialTransformation.postgres.test.ts",
]

function contained(candidate, root) {
    const relative = path.relative(root, candidate)
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function argumentsOf(args) {
    const options = {}
    for (let i = 0; i < args.length; i += 2) {
        if (!["--postgres-bin", "--artifacts", "--suite"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || options[args[i]]) {
            throw new Error("Usage: node scripts/test-postgres.cjs --postgres-bin <directory> --artifacts <new directory outside both repositories>")
        }
        options[args[i]] = args[i + 1]
    }
    if (!options["--postgres-bin"] || !options["--artifacts"]) throw new Error("Both --postgres-bin and --artifacts are required")
    return options
}

function artifactDirectory(input) {
    const target = path.resolve(input)
    if (fs.existsSync(target)) throw new Error("Artifacts directory must not already exist")
    // Resolve the existing parent to reject junctions/symlinks into either repo.
    const parent = fs.realpathSync(path.dirname(target))
    const resolved = path.join(parent, path.basename(target))
    for (const repo of [repository, frontend]) {
        if (contained(resolved, fs.realpathSync(repo))) throw new Error("Artifacts must be outside both repositories")
    }
    return resolved
}

function safeEnvironment(source = process.env) {
    const result = {}
    const allowed = new Set(["SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "LANG", "LC_ALL"])
    for (const [key, value] of Object.entries(source)) if (allowed.has(key.toUpperCase())) result[key] = value
    return result
}

function freePort() {
    return new Promise((resolve, reject) => {
        const socket = net.createServer()
        socket.on("error", reject)
        socket.listen(0, "127.0.0.1", () => {
            const port = socket.address().port
            socket.close(error => error ? reject(error) : resolve(port))
        })
    })
}

function verifyPidFile(data, port, expectedPid) {
    const lines = fs.readFileSync(path.join(data, "postmaster.pid"), "utf8").trim().split(/\r?\n/)
    const pid = Number(lines[0])
    if (!Number.isSafeInteger(pid) || pid <= 0 || path.resolve(lines[1]) !== path.resolve(data) || Number(lines[3]) !== port || (expectedPid && pid !== expectedPid)) {
        throw new Error("Cluster PID file does not match the newly-created data directory and port")
    }
    return pid
}

async function main(args = process.argv.slice(2)) {
    const options = argumentsOf(args)
    const selectedSuites = options["--suite"] ? suites.filter(suite => suite === options["--suite"]) : suites
    if (!selectedSuites.length) throw new Error("Unknown isolated integration suite")
    const artifacts = artifactDirectory(options["--artifacts"])
    const binaries = fs.realpathSync(options["--postgres-bin"])
    const executable = name => path.join(binaries, `${name}${process.platform === "win32" ? ".exe" : ""}`)
    for (const name of ["initdb", "pg_ctl"]) if (!fs.existsSync(executable(name))) throw new Error(`Missing PostgreSQL binary: ${name}`)
    for (const suite of selectedSuites) if (!fs.existsSync(path.join(repository, suite))) throw new Error(`Missing integration suite: ${suite}`)
    const id = crypto.randomUUID().replace(/-/g, "")
    const owner = `test_owner_${id}`
    const app = `test_app_${id}`
    const database = `legumex_test_${id}`
    const password = crypto.randomBytes(32).toString("hex")
    const appPassword = crypto.randomBytes(32).toString("hex")
    const port = await freePort()
    fs.mkdirSync(artifacts, { mode: 0o700 })
    const cluster = path.join(artifacts, `cluster-${id}`)
    fs.mkdirSync(cluster, { mode: 0o700 })
    const data = path.join(cluster, "data")
    const pwfile = path.join(cluster, "owner-password.local")
    fs.writeFileSync(pwfile, `${password}\n`, { flag: "wx", mode: 0o600 })
    const environment = safeEnvironment()
    const redact = output => String(output ?? "").split(password).join("[REDACTED]").split(appPassword).join("[REDACTED]").replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE URL REDACTED]")
    function run(name, command, parameters, env = environment) {
        // File handles avoid waiting forever for a background postgres descendant
        // to close a captured stdout/stderr pipe on Windows.
        const logfile = path.join(cluster, `${name}.log`)
        const output = fs.openSync(logfile, "wx", 0o600)
        let result
        try { result = spawnSync(command, parameters, { cwd: repository, env, windowsHide: true, stdio: ["ignore", output, output], timeout: name === "jest" ? 600000 : 120000 }) }
        finally { fs.closeSync(output) }
        fs.writeFileSync(logfile, redact(fs.readFileSync(logfile, "utf8")))
        if (result.error || result.status !== 0) throw new Error(`${name} failed; inspect its redacted local log`)
        return result
    }
    let started = false
    let pid
    let client
    let failure
    try {
        run("initdb", executable("initdb"), ["-D", data, "-U", owner, "--pwfile", pwfile, "--auth-host=scram-sha-256", "--auth-local=scram-sha-256", "--encoding=UTF8", "--no-locale"])
        // Owned config rather than shell-quoted -o arguments; no inherited cluster settings.
        fs.appendFileSync(path.join(data, "postgresql.conf"), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\npassword_encryption = 'scram-sha-256'\nssl = off\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\n`)
        started = true // Also attempt cleanup when pg_ctl starts the server but reports a failure.
        run("start", executable("pg_ctl"), ["-D", data, "-l", path.join(cluster, "postgres.log"), "-w", "-t", "30", "start"])
        pid = verifyPidFile(data, port)
        const { Client } = require("pg")
        client = new Client({ host: "127.0.0.1", port, user: owner, password, database: "postgres", ssl: false, connectionTimeoutMillis: 5000 })
        await client.connect()
        const identity = (await client.query("SELECT current_user, current_setting('data_directory') AS data_directory, current_setting('port') AS port")).rows[0]
        if (identity.current_user !== owner || path.resolve(identity.data_directory) !== path.resolve(data) || Number(identity.port) !== port) throw new Error("Server identity does not match the owned cluster")
        verifyPidFile(data, port, pid)
        // Generated hex identifiers/passwords only; never interpolate user input in SQL.
        await client.query(`CREATE ROLE "${app}" LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`)
        await client.query(`CREATE DATABASE "${database}" OWNER "${owner}"`)
        await client.end()
        client = undefined
        const url = (user, secret) => `postgresql://${user}:${secret}@127.0.0.1:${port}/${database}?sslmode=disable`
        const testEnvironment = {
            ...environment, NODE_ENV: "test", DB_SYNC_ALTER: "false", FRONTEND_URL: "http://localhost:5173",
            TEST_DATABASE_URL: url(owner, password), TEST_APP_DATABASE_URL: url(app, appPassword), DATABASE_URL: url(app, appPassword),
            LEGUMEX_TEST_CLUSTER_DIR: data, LEGUMEX_ISOLATED_POSTGRES: "1",
            LEGUMEX_TEST_POSTGRES_BIN: binaries,
            JWT_SECRET: crypto.randomBytes(32).toString("hex"), JWT_EXPIRES_IN: "8h", SERVER_PORT: "4000",
            AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "isolated-test", AWS_SECRET_ACCESS_KEY: "isolated-test", AWS_S3_BUCKET_NAME: "isolated-test",
            MICROSOFT_TENANT_ID: "00000000-0000-0000-0000-000000000001", MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000002", MICROSOFT_CLIENT_SECRET: "isolated-test", NOREPLY_USER: "isolated@example.invalid",
            CI: "true",
        }
        run("jest", process.execPath, [require.resolve("jest/bin/jest"), "--runInBand", "--coverage=false", "--runTestsByPath", ...selectedSuites], testEnvironment)
        fs.writeFileSync(path.join(cluster, "result.json"), JSON.stringify({ success: true, suites: selectedSuites, port, owner, app, database }, null, 2), { flag: "wx", mode: 0o600 })
    } catch (error) {
        failure = error
    } finally {
        if (client) await client.end().catch(() => {})
        if (started && fs.existsSync(path.join(data, "postmaster.pid"))) {
            try {
                verifyPidFile(data, port, pid)
                run("stop", executable("pg_ctl"), ["-D", data, "-m", "fast", "-w", "-t", "30", "stop"])
            } catch (error) { failure = new Error(`${failure ? `${failure.message}; ` : ""}cluster cleanup failed: ${error.message}`) }
        }
    }
    if (failure) throw failure
    console.log(`Isolated PostgreSQL integration passed. Local artifacts: ${artifacts}`)
}

module.exports = { argumentsOf, artifactDirectory, contained, safeEnvironment, verifyPidFile }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
