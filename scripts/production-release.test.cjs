"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { identity, argumentsOf, backupDirectory, childEnvironment, inspect, rebuildPublic } = require("./production-release.cjs")
const { parseDestination } = require("./migrate.cjs")
const url = "postgresql://synthetic_owner:Synthetic-secret%21@production.invalid:5432/synthetic_production?sslmode=verify-full"
const target = parseDestination(url)

test("identity is offline, excludes credentials and produces an unapproved registry candidate", () => {
    const result = identity({ PROD_DATABASE_URL: url })
    assert.equal(result.database, "synthetic_production")
    assert.equal(result.fingerprint, target.fingerprint)
    assert.equal(result.candidatePolicy.targets[0].isolatedCredentialsVerified, false)
    assert.ok(!JSON.stringify(result).includes("Synthetic-secret"))
    assert.throws(() => identity({ DATABASE_URL: url }))
    assert.throws(() => identity({ PROD_DATABASE_URL: url.replace("verify-full", "disable") }))
})

test("commands require explicit production, backup and binaries; no implicit destructive default", () => {
    assert.deepEqual(argumentsOf(["identity"]), { action: "identity", own: {}, runner: [] })
    assert.deepEqual(argumentsOf(["rebuild", "--backup-dir", "backup", "--postgres-bin", "bin", "--env", "production", "--plan"]).runner, ["--env", "production", "--plan"])
    for (const args of [[], ["drop"], ["check", "--force"], ["backup"], ["rebuild", "--backup-dir", "b", "--postgres-bin", "p", "--env", "test"], ["identity", "--backup-dir", "b"]]) assert.throws(() => argumentsOf(args))
})

test("backup files must stay outside both repositories", () => {
    const path = require("node:path")
    for (const name of ["..", "../scratchpad/backup", "../../frontendLegumexStore/backups"]) assert.throws(() => backupDirectory(path.resolve(__dirname, name)))
    assert.equal(backupDirectory(path.resolve(__dirname, "../../.local-production-backup-test")), path.resolve(__dirname, "../../.local-production-backup-test"))
})

test("backup child receives explicit verified TLS and never inherits connection/role/script overrides", () => {
    const old = process.env.PGOPTIONS
    try {
        process.env.PGOPTIONS = "-c role=other"
        const env = childEnvironment(target.config)
        assert.equal(env.PGOPTIONS, undefined)
        assert.equal(env.DATABASE_URL, undefined)
        assert.equal(env.NODE_OPTIONS, undefined)
        assert.equal(env.PGSSLMODE, "verify-full")
        assert.equal(env.PGHOST, "production.invalid")
        assert.equal(env.PGPASSWORD, target.config.password)
    } finally { if (old === undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = old }
})

const live = { database: "synthetic_production", username: "synthetic_owner", tls: true, other_sessions: 0, server_version_num: "170004", tables: 47 }
function client(overrides = {}, failSql = false) {
    const queries = []
    return { queries, query: async sql => {
        queries.push(sql)
        if (sql.includes("SELECT current_database()")) return { rows: [{ ...live, ...overrides }] }
        if (sql.includes("AS custom_schemas")) return { rows: [{ custom_schemas: overrides.custom_schemas ?? 0, public_extensions: overrides.public_extensions ?? 0 }] }
        if (sql === "destructive-fixture" && failSql) throw new Error("synthetic SQL failure")
        return { rows: [] }
    } }
}
const env = { PRODUCTION_WRITES_STOPPED: "true", REBUILD_CONFIRM_DATABASE: "synthetic_production" }

test("inspection rejects wrong live database/user or unencrypted session", async () => {
    for (const change of [{ database: "another_database" }, { username: "another_user" }, { tls: false }]) await assert.rejects(inspect(client(change), target))
})

test("rebuild requires separate write-stop and database confirmation before SQL", async () => {
    for (const unsafe of [{}, { ...env, REBUILD_CONFIRM_DATABASE: "other" }, { ...env, PRODUCTION_WRITES_STOPPED: "false" }]) {
        const c = client()
        await assert.rejects(rebuildPublic(c, target, unsafe, "destructive-fixture"))
        assert.deepEqual(c.queries, [])
    }
})

test("rebuild refuses sessions, custom schemas, extensions and wrong identities with rollback", async () => {
    for (const change of [{ other_sessions: 1 }, { custom_schemas: 1 }, { public_extensions: 1 }, { tls: false }, { database: "other" }]) {
        const c = client(change)
        await assert.rejects(rebuildPublic(c, target, env, "destructive-fixture"))
        assert.ok(!c.queries.includes("destructive-fixture"))
        assert.equal(c.queries.at(-1), "ROLLBACK")
    }
})

test("approved reconstruction shares migration lock, commits on success and rolls back SQL failures", async () => {
    const good = client()
    await rebuildPublic(good, target, env, "destructive-fixture")
    assert.ok(good.queries.indexOf("SELECT pg_advisory_xact_lock(174226,1)") < good.queries.indexOf("destructive-fixture"))
    assert.equal(good.queries.at(-1), "COMMIT")
    const bad = client({}, true)
    await assert.rejects(rebuildPublic(bad, target, env, "destructive-fixture"))
    assert.equal(bad.queries.at(-1), "ROLLBACK")
})

test("archive hashing streams bytes and rejects malformed local files", async () => {
    const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os")
    const { archiveInfo } = require("./production-release.cjs")
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "legumex-release-proof-"))
    const file = path.join(directory, "sample.dump")
    await fs.writeFile(file, Buffer.concat([Buffer.from("PGDMP"), Buffer.alloc(150)]))
    const result = await archiveInfo(file)
    assert.equal(result.bytes, 155)
    assert.equal(result.sha256, require("node:crypto").createHash("sha256").update(await fs.readFile(file)).digest("hex"))
    await fs.writeFile(file, "invalid archive")
    await assert.rejects(archiveInfo(file))
    // All fixtures are new local files; no existing backups are removed.
})

test("rebuild refuses altered, expired, future or cross-destination backup proofs before invoking a utility", async () => {
    const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os")
    const { archiveInfo, rebuildArtifact } = require("./production-release.cjs")
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "legumex-release-proof-")))
    await fs.writeFile(path.join(directory, "database.dump"), Buffer.concat([Buffer.from("PGDMP"), Buffer.alloc(150)]))
    const info = await archiveInfo(path.join(directory, "database.dump"))
    const now = Date.now()
    const proof = { version: 1, fingerprint: target.fingerprint, databaseFingerprint: target.databaseFingerprint, database: target.config.database, user: target.config.user, createdAt: new Date(now).toISOString(), ...info }
    for (const change of [{ sha256: "a".repeat(64) }, { fingerprint: "b".repeat(64) }, { database: "development" }, { user: "other" }, { bytes: 500 }, { createdAt: new Date(now + 1).toISOString() }, { createdAt: new Date(now - 86400001).toISOString() }]) {
        await fs.writeFile(path.join(directory, "backup-manifest.json"), JSON.stringify({ ...proof, ...change }))
        await assert.rejects(rebuildArtifact(directory, target, "missing-binaries-never-run", now), /Backup proof missing, changed, expired or bound to another destination/)
    }
})
