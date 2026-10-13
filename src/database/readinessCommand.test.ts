import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import path from "node:path"
import { generateKeyPairSync, sign } from "node:crypto"
import { PERMISSIONS } from "./accessControlPolicy"
import { readReadinessSnapshots, ReadinessReadError } from "./readinessPostgres"
import { diagnoseAccessControl, diagnosePackagingGroups } from "./readinessDiagnostics"
const { run, ReadinessCommandError } = require("../../scripts/readiness.cjs")
const { parseDestination, approvalDigest } = require("../../scripts/migrate.cjs")
const { canonicalApprovalBytes } = require("../../scripts/readiness-approval.cjs")
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const now = Date.parse("2026-10-12T12:00:00Z")
const expires = "2026-10-12T12:10:00.000Z"
const trustedApprovers = [{ keyId: "reviewer-key", approverId: "reviewer", publicKey, revoked: false,
    notBefore: "2026-10-12T11:00:00.000Z", notAfter: "2026-10-12T13:00:00.000Z" }]
function tokenFor(payload: unknown) {
    return Buffer.from(JSON.stringify({ payload, signature: sign(null, canonicalApprovalBytes(payload), privateKey).toString("base64url") })).toString("base64url")
}
function planArgs(s: { args: string[] }) { return [...s.args, "--plan", "--expires", expires, "--approver-id", "reviewer", "--key-id", "reviewer-key"] }
const local = "postgres://reader:synthetic@127.0.0.1:5432/isolated"
const prod = "postgres://reader:synthetic@production.invalid:5432/live?sslmode=verify-full"
function rowsFor(sql: string): Record<string, unknown>[] {
    if (sql.includes("current_setting")) return [{ transaction_isolation: "repeatable read", transaction_read_only: "on" }]
    if (sql.includes("public.permissions")) return PERMISSIONS.map((row, i) => ({ id: i + 1, name: row.name }))
    if (sql.includes("public.roles")) return [{ id: 1, name: "Administrador" }]
    if (sql.includes("public.role_permissions")) return PERMISSIONS.map((_row, i) => ({ role_id: 1, permission_id: i + 1 }))
    if (sql.includes("public.users")) return [{ id: 1, username: "admin-fixture", role_id: 1 }]
    if (sql.includes('public."packagingGroups"')) return [{ id: 1, displayName: "Caja", nameKey: "caja", isActive: false }]
    if (sql.includes('public."productVariantUnitMaterials"')) return [{ id: 1, productVariantId: 1, packagingId: 1, optionGroup: "Caja", isActive: true, isDefault: false, optionGroupId: 1 }]
    return []
}
function response(sql: string) {
    if (!sql.startsWith("SELECT")) return { command: sql.split(" ")[0], rows: [], fields: [], rowCount: null }
    const rows = rowsFor(sql)
    const names = sql.includes("current_setting") ? ["transaction_isolation", "transaction_read_only"]
        : sql.slice(7, sql.indexOf(" FROM ")).replace(/"/g, "").split(", ")
    return { command: "SELECT", rows, fields: names.map(name => ({ name })), rowCount: rows.length }
}
function setup(url = local, environment = "development") {
    const target = parseDestination(url)
    const prefix = { development: "DEV", test: "TEST", production: "PROD" }[environment]!
    const env: Record<string, string> = { [`READINESS_${prefix}_DATABASE_URL`]: url, [`READINESS_${prefix}_TARGET_SHA256`]: target.fingerprint }
    const targetPolicy = { productionDatabases: [parseDestination(prod).databaseFingerprint], targets: [
        { environment, fingerprint: target.fingerprint, databaseFingerprint: target.databaseFingerprint, isolatedCredentialsVerified: true, readOnlyCredentialsVerified: true },
    ] }
    const clients: any[] = []
    const configs: any[] = []
    const read = jest.fn(readReadinessSnapshots)
    const runtime = { readReadinessSnapshots: read, ReadinessReadError, diagnoseAccessControl, diagnosePackagingGroups }
    const deps = { now: () => now, trustedApprovers: trustedApprovers.map(record => ({ ...record })), targetPolicy, runtimeLoader: jest.fn(async () => runtime), createClient: jest.fn((config: unknown) => {
        configs.push(config)
        const client = new EventEmitter() as any
        client.connect = jest.fn(async () => undefined)
        client.end = jest.fn(async () => undefined)
        client.query = jest.fn(async (sql: string) => response(sql))
        clients.push(client)
        return client
    }) }
    return { env, deps, clients, configs, read, runtime, args: ["--env", environment, "--initial-admin-username", "admin-fixture"] }
}
async function rejected(s: ReturnType<typeof setup>, args = s.args) {
    await expect(run(args, s.env, s.deps)).rejects.toBeInstanceOf(ReadinessCommandError)
    expect(s.deps.createClient).not.toHaveBeenCalled()
    expect(s.read).not.toHaveBeenCalled()
}

test("real adapter and pure diagnoses integrated with only a simulated dedicated client", async () => {
    const s = setup()
    s.read.mockImplementation(async (client, opts) => {
        expect((client.query as jest.Mock).mock.calls).toEqual([])
        return readReadinessSnapshots(client, opts)
    })
    const report = await run(s.args, s.env, s.deps)
    expect(s.read).toHaveBeenCalledTimes(1)
    expect(s.clients[0].connect).toHaveBeenCalledTimes(1)
    expect(s.clients[0].end).toHaveBeenCalledTimes(1)
    expect(s.clients[0].query.mock.calls[0]).toEqual(["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"])
    expect(s.clients[0].query.mock.calls.at(-1)).toEqual(["ROLLBACK"])
    expect(s.configs[0]).toMatchObject({ connectionTimeoutMillis: 10000, query_timeout: 10000, application_name: "legumex-readiness", host: "127.0.0.1", port: 5432, user: "reader" })
    expect(s.configs[0]).not.toHaveProperty("connectionString")
    expect(report).toMatchObject({ access: { status: "prepared", authenticationVerified: false }, packaging: { status: "prepared", calculationVerified: false,
        findings: [{ code: "active_association_inactive_group", severity: "info", count: 1 }] }, schemaCompatibility: "unknown", repairsPerformed: false })
    expect(JSON.stringify(report)).not.toMatch(/admin-fixture|synthetic|postgres:|password|Caja|categories:view|username/)
    for (const [sql] of s.clients[0].query.mock.calls) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COMMIT|GRANT|REVOKE)\b/i)
})
test("fresh clients for each execution", async () => {
    const s = setup()
    await run(s.args, s.env, s.deps)
    await run(s.args, s.env, s.deps)
    expect(s.clients).toHaveLength(2)
    expect(s.clients[0]).not.toBe(s.clients[1])
    expect(s.clients.every(client => client.end.mock.calls.length === 1)).toBe(true)
})
test.each([[], ["--env", "staging"], ["--env", "Production"], ["--env"], ["--env", "test", "--sql", "SELECT 1"],
    ["--env", "test", "--repair", "true"], ["--env", "test", "--env", "test"], ["--env", "test", "--initial-admin-username", ""],
].map(args => ({ args })))("rejects unsafe or missing arguments %# before creating clients", async ({ args }) => { await rejected(setup(), args) })
test("no migration credential fallback", async () => {
    const s = setup()
    s.env = { DEV_DATABASE_URL: local, DATABASE_URL: prod, NODE_ENV: "development" }
    await rejected(s)
})
test("unknown target, absent pin, alternate tunnel port and empty inventory rejected", async () => {
    const unregistered = setup(); unregistered.deps.targetPolicy.targets = []; await rejected(unregistered)
    const noPin = setup(); delete noPin.env.READINESS_DEV_TARGET_SHA256; await rejected(noPin)
    const tunnel = setup(); tunnel.env.READINESS_DEV_DATABASE_URL = local.replace(":5432", ":6543"); await rejected(tunnel)
    const empty = setup(); empty.deps.targetPolicy.productionDatabases = []; await rejected(empty)
})
test("review of dedicated read-only credentials required", async () => {
    const s = setup(); s.deps.targetPolicy.targets[0].readOnlyCredentialsVerified = false; await rejected(s)
})
test("production cannot be relabeled as development", async () => { await rejected(setup(prod)) })
test("authorized production read-only destination uses strict TLS", async () => {
    const s = setup(prod, "production")
    await run(await approvedArgs(s), s.env, s.deps)
    expect(s.configs[0].ssl).toEqual({ rejectUnauthorized: true })
    expect(s.configs[0].sslnegotiation).toBe("postgres")
})
test.each(["disable", "require", "prefer", "verify-ca", ""])("remote insecure TLS %j rejected", async mode => {
    const s = setup(prod)
    s.env.READINESS_DEV_DATABASE_URL = prod.replace("verify-full", mode)
    await rejected(s)
})
test.each(["PGHOST", "PGPORT", "PGOPTIONS", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGSERVICE", "PGANYTHING"])("rejects %s", async key => {
    const s = setup(); s.env[key] = "private"; await rejected(s)
})
test("ambient PG* rejected even when absent in supplied configuration", async () => {
    const previous = process.env.PGOPTIONS
    try { process.env.PGOPTIONS = "private"; await rejected(setup()) }
    finally { if (previous === undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = previous }
})
test("stale build prevents creating clients and suppresses loader errors", async () => {
    const s = setup(); s.deps.runtimeLoader.mockRejectedValueOnce(new Error("private build path credentials"))
    await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "BUILD_UNAVAILABLE" })
    expect(s.deps.createClient).not.toHaveBeenCalled()
})
test("default runtime loader checks audited build integrity before creating clients", async () => {
    const s = setup()
    const integrity = require("../../scripts/build-integrity.cjs")
    const check = jest.spyOn(integrity, "run").mockRejectedValueOnce(new Error("private stale artifact"))
    try {
        await expect(run(s.args, s.env, { targetPolicy: s.deps.targetPolicy, createClient: s.deps.createClient }))
            .rejects.toMatchObject({ code: "BUILD_UNAVAILABLE" })
        expect(check).toHaveBeenCalledWith("verify")
        expect(s.deps.createClient).not.toHaveBeenCalled()
    } finally { check.mockRestore() }
})
test.each(["connect", "end"])("handles %s failure without leaking driver details", async stage => {
    const s = setup(); const factory = s.deps.createClient.getMockImplementation()!
    s.deps.createClient.mockImplementation(config => {
        const client = factory(config); client[stage].mockRejectedValueOnce(new Error("private password and SQL")); return client
    })
    const error = await run(s.args, s.env, s.deps).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ReadinessCommandError)
    expect(error.message).not.toMatch(/private|password|SQL/)
    expect(s.clients[0].end).toHaveBeenCalledTimes(1)
    if (stage === "connect") expect(s.read).not.toHaveBeenCalled()
    else expect(error.closeFailed).toBe(true)
})
test("primary adapter error preserved if end also fails", async () => {
    const s = setup(); s.read.mockRejectedValueOnce(new ReadinessReadError("TRANSACTION_NOT_ISOLATED", true))
    const factory = s.deps.createClient.getMockImplementation()!
    s.deps.createClient.mockImplementation(config => { const client = factory(config); client.end.mockRejectedValueOnce("private"); return client })
    await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "TRANSACTION_NOT_ISOLATED", closeFailed: true, rollbackFailed: true })
})
test("query failure never produces a prepared report", async () => {
    const s = setup(); s.read.mockRejectedValueOnce(new ReadinessReadError("MISSING_TABLE"))
    await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "MISSING_TABLE" })
    expect(s.clients[0].end).toHaveBeenCalledTimes(1)
})
test("safe listener handles idle errors during connect and close", async () => {
    for (const stage of ["connect", "end"]) {
        const s = setup(); const factory = s.deps.createClient.getMockImplementation()!
        s.deps.createClient.mockImplementation(config => { const client = factory(config); client[stage].mockImplementation(async () => { client.emit("error", new Error("private driver details")) }); return client })
        await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "CLIENT_FAILED" })
        expect(s.clients[0].end).toHaveBeenCalledTimes(1)
    }
})
test("reports missing catalog and pending packaging separately", async () => {
    const s = setup()
    s.read.mockResolvedValueOnce({ access: { permissions: [], roles: [], users: [], rolePermissions: [], initialAdminUsername: "private identity" },
        packaging: { groups: [], associations: [{ id: 1, level: "unit", productVariantId: 1, packagingId: 1, optionGroup: "private label", optionGroupId: null, isActive: false, isDefault: false }] } })
    const report = await run(s.args, s.env, s.deps)
    expect(report.access.status).toBe("incomplete")
    expect(report.packaging.status).toBe("incomplete")
    expect(report.access.findings).toContainEqual({ code: "missing_permissions", severity: "warning", count: 78 })
    expect(report.packaging.findings).toEqual([{ code: "missing_group_id", severity: "warning", count: 1 }])
    expect(JSON.stringify(report)).not.toMatch(/private/)
})
test("entrypoint does not load application, seeders or migration operations", () => {
    const source = readFileSync(path.join(__dirname, "../../scripts/readiness.cjs"), "utf8")
    expect(source).toContain("const { destination, parseDestination } = require('./migrate.cjs')")
    expect(source).not.toMatch(/\.migrate\(|\.sync\(|runSeeders|\.Pool\(|dotenv|connection\.ts|config\/env|dist\/index|dist\/server/)
    expect(source).toContain("new (require('pg').Client)(config)")
    expect(source).toContain("require.main === module")
})

async function approvedArgs(s: ReturnType<typeof setup>) {
    const plan = await run(planArgs(s), s.env, s.deps)
    return [...s.args, "--expires", expires, "--approval", tokenFor(plan.approvalRequest)]
}
test("production registry alone does not authorize connection", async () => {
    const s = setup(prod, "production")
    await rejected(s)
    await rejected(s, [...s.args, "--expires", expires])
    expect(s.deps.runtimeLoader).not.toHaveBeenCalled()
})
test("production planning is completely offline", async () => {
    const s = setup(prod, "production")
    const plan = await run(planArgs(s), s.env, s.deps)
    expect(plan).toMatchObject({ offline: true, targetFingerprint: parseDestination(prod).fingerprint, expires })
    expect(plan.approvalRequest.nonce).toMatch(/^[a-f0-9]{64}$/)
    expect(plan).not.toHaveProperty("approvalDigest")
    expect(s.deps.createClient).not.toHaveBeenCalled()
    expect(s.deps.runtimeLoader).not.toHaveBeenCalled()
    expect(JSON.stringify(plan)).not.toMatch(/postgres:|synthetic/)
})
test.each(["2026-10-12T11:59:59Z", "2026-10-12T12:00:00Z", "2026-10-12T13:00:01Z", "", "2026-02-30T12:30:00Z", "2026-10-12T12:30:00Z\n"])("invalid or expired approval %j rejected", async expiry => {
    const s = setup(prod, "production")
    await rejected(s, [...s.args, "--expires", expiry, "--approval", "a".repeat(64)])
})
test("approval for another destination rejected", async () => {
    const first = setup(prod, "production")
    const args = await approvedArgs(first)
    const other = setup(prod.replace("production.invalid", "other.invalid"), "production")
    await rejected(other, args)
})
test("migration and readiness confirmations have distinct domains", async () => {
    const s = setup(prod, "production")
    const args = await approvedArgs(s)
    const migrationDigest = approvalDigest(parseDestination(prod).fingerprint, [], expires)
    expect(args.at(-1)).not.toBe(migrationDigest)
    await rejected(s, [...s.args, "--expires", expires, "--approval", migrationDigest])
})
test("approval binds expiry and optional administrator identity", async () => {
    const s = setup(prod, "production")
    const args = await approvedArgs(s)
    await rejected(s, args.map(value => value === "admin-fixture" ? "different-admin" : value))
    await rejected(s, args.map(value => value === expires ? "2026-10-12T12:31:00Z" : value))
})
test("approval expiring during artifact validation rejected before creating client", async () => {
    const s = setup(prod, "production")
    const args = await approvedArgs(s)
    // The injected function is captured at run entry, so advance its shared clock.
    let clock = now
    s.deps.now = () => clock
    s.deps.runtimeLoader.mockImplementation(async () => { clock = Date.parse(expires); return s.runtime })
    await expect(run(args, s.env, s.deps)).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" })
    expect(s.deps.createClient).not.toHaveBeenCalled()
})
test.each(["--expires", "--approval", "--plan"])("production-only option %s rejected in development", async flag => {
    const s = setup()
    await rejected(s, [...s.args, flag, ...(flag === "--plan" ? [] : [expires])])
})
test("backend credentials with identical connection identity rejected", async () => {
    const s = setup()
    s.env.DATABASE_URL = local
    await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "BACKEND_CREDENTIALS_REUSED" })
    expect(s.deps.createClient).not.toHaveBeenCalled()
})
test.each([
    "postgresql://re%61der:otherpassword@HOST.invalid:05432/%6cive?sslmode=verify-full",
    "postgres://reader:otherpassword@host.invalid.:5432/live?sslmode=verify-full",
])("different URLs representing identical normalized identity rejected %#", async backend => {
    const s = setup("postgres://reader:synthetic@host.invalid:5432/live?sslmode=verify-full", "production")
    s.env.DATABASE_URL = backend
    await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "BACKEND_CREDENTIALS_REUSED" })
    expect(s.deps.createClient).not.toHaveBeenCalled()
})
test.each([
    "postgres://backend:private@host.invalid/live?sslmode=verify-full",
    "postgres://backend:private@host..invalid:5432/live?sslmode=verify-full",
    "postgres://backend:private@127.1:5432/live?sslmode=verify-full",
    "postgres://backend:private@host.invalid:0/live?sslmode=verify-full",
    "postgres://backend:private@host.invalid:5432/live?options=private",
    " postgres://backend:private@host.invalid:5432/live?sslmode=verify-full", "",
])("ambiguous backend identity %# rejected without leaking values", async backend => {
    const s = setup()
    s.env.DATABASE_URL = backend
    const error = await run(s.args, s.env, s.deps).catch((value: unknown) => value)
    expect(error.code).toBe("IDENTITY_COMPARISON_UNAVAILABLE")
    expect(error.message).not.toMatch(/private|postgres|backend|host\.invalid/)
    expect(s.deps.createClient).not.toHaveBeenCalled()
})
test("ambiguous readiness hostname rejected before creating client", async () => {
    const s = setup()
    s.env.READINESS_DEV_DATABASE_URL = "postgres://reader:synthetic@127.1:5432/isolated?sslmode=verify-full"
    await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "IDENTITY_COMPARISON_UNAVAILABLE" })
    expect(s.deps.createClient).not.toHaveBeenCalled()
})
test("absent DATABASE_URL permits reviewed dedicated credentials but does not verify privileges", async () => {
    const s = setup()
    expect(s.env).not.toHaveProperty("DATABASE_URL")
    await expect(run(s.args, s.env, s.deps)).resolves.toHaveProperty("access.status", "prepared")
})
test("different backend username on same production database is compared without fallback", async () => {
    const s = setup(prod, "production")
    s.env.DATABASE_URL = prod.replace("reader", "backend")
    const args = await approvedArgs(s)
    await run(args, s.env, s.deps)
    expect(s.configs[0].user).toBe("reader")
})

test.each([
    ["altered signature", "APPROVAL_SIGNATURE_INVALID"],
    ["altered signed request", "APPROVAL_SIGNATURE_INVALID"],
    ["unknown key", "APPROVAL_KEY_UNAUTHORIZED"],
    ["revoked key", "APPROVAL_KEY_REVOKED"],
    ["expired key", "APPROVAL_KEY_EXPIRED"],
    ["not yet active key", "APPROVAL_KEY_NOT_ACTIVE"],
    ["wrong destination", "APPROVAL_TARGET_MISMATCH"],
    ["migration signature", "APPROVAL_PROTOCOL_MISMATCH"],
    ["wrong protocol version", "APPROVAL_PROTOCOL_MISMATCH"],
    ["expired approval", "APPROVAL_EXPIRED"],
    ["excessively future approval", "APPROVAL_EXPIRY_TOO_FAR"],
    ["missing nonce", "APPROVAL_MALFORMED"],
    ["malformed nonce", "APPROVAL_MALFORMED"],
    ["wrong signer", "APPROVAL_SIGNATURE_INVALID"],
    ["unapproved approver", "APPROVAL_KEY_UNAUTHORIZED"],
    ["private key in trust record", "APPROVAL_KEY_UNAUTHORIZED"],
] as const)("signed approval rejects %s before any client creation", async (scenario, code) => {
    const s = setup(prod, "production")
    const args = await approvedArgs(s)
    const envelope = JSON.parse(Buffer.from(args.at(-1)!, "base64url").toString("utf8"))
    if (scenario === "altered signature") envelope.signature = (envelope.signature[0] === "A" ? "B" : "A") + envelope.signature.slice(1)
    if (scenario === "altered signed request") envelope.payload.nonce = "b".repeat(64)
    if (scenario === "unknown key") s.deps.trustedApprovers = []
    if (scenario === "revoked key") s.deps.trustedApprovers[0].revoked = true
    if (scenario === "expired key") s.deps.trustedApprovers[0].notAfter = "2026-10-12T11:59:00.000Z"
    if (scenario === "not yet active key") s.deps.trustedApprovers[0].notBefore = "2026-10-12T12:01:00.000Z"
    if (scenario === "wrong destination") envelope.payload.targetFingerprint = "c".repeat(64)
    if (scenario === "migration signature") {
        envelope.payload.domain = "LEGUMEX production migration"
        envelope.signature = sign(null, Buffer.from(JSON.stringify(Object.values(envelope.payload))), privateKey).toString("base64url")
    }
    if (scenario === "wrong protocol version") envelope.payload.version = 1
    if (scenario === "expired approval" || scenario === "excessively future approval") {
        envelope.payload.expires = scenario === "expired approval" ? "2026-10-12T11:59:00.000Z" : "2026-10-12T12:15:00.001Z"
        envelope.signature = sign(null, canonicalApprovalBytes(envelope.payload), privateKey).toString("base64url")
        args[args.indexOf("--expires") + 1] = envelope.payload.expires
    }
    if (scenario === "missing nonce") delete envelope.payload.nonce
    if (scenario === "malformed nonce") envelope.payload.nonce = "weak"
    if (scenario === "wrong signer") envelope.signature = sign(null, canonicalApprovalBytes(envelope.payload), generateKeyPairSync("ed25519").privateKey).toString("base64url")
    if (scenario === "unapproved approver") envelope.payload.approverId = "other-reviewer"
    if (scenario === "private key in trust record") s.deps.trustedApprovers[0].publicKey = privateKey
    args[args.length - 1] = Buffer.from(JSON.stringify(envelope)).toString("base64url")
    const error = await run(args, s.env, s.deps).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ReadinessCommandError)
    expect(error.code).toBe(code)
    expect(error.message).not.toMatch(/synthetic|postgres:|admin-fixture|PRIVATE KEY/)
    expect(s.deps.createClient).not.toHaveBeenCalled()
    expect(s.deps.runtimeLoader).not.toHaveBeenCalled()
})
test("missing production approval has a distinct required code", async () => {
    const s = setup(prod, "production")
    await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "PRODUCTION_APPROVAL_REQUIRED" })
    expect(s.deps.createClient).not.toHaveBeenCalled()
})
test("production remains blocked with default trust despite an otherwise valid signature", async () => {
    const s = setup(prod, "production")
    const args = await approvedArgs(s)
    const { trustedApprovers: ignored, ...withoutTrust } = s.deps
    s.env.READINESS_APPROVAL_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString()
    await expect(run(args, s.env, withoutTrust)).rejects.toMatchObject({ code: "APPROVAL_KEY_UNAUTHORIZED" })
    expect(s.deps.createClient).not.toHaveBeenCalled()
    await rejected(s, [...args, "--public-key", "operator-key"])
})
test("a signed nonce does not prevent replay within the validity window", async () => {
    const s = setup(prod, "production")
    const args = await approvedArgs(s)
    await run(args, s.env, s.deps)
    await run(args, s.env, s.deps)
    expect(s.clients).toHaveLength(2)
    expect(s.clients[0]).not.toBe(s.clients[1])
})
test("canonical signed representation is fixed and independent of object key order", async () => {
    const s = setup(prod, "production")
    const plan = await run(planArgs(s), s.env, s.deps)
    const payload = plan.approvalRequest
    const reversed = Object.fromEntries(Object.entries(payload).reverse())
    expect(canonicalApprovalBytes(payload)).toEqual(canonicalApprovalBytes(reversed))
    expect(JSON.parse(canonicalApprovalBytes(payload).toString("utf8"))).toEqual([
        "LEGUMEX/readiness-production-approval", 2, "production", parseDestination(prod).fingerprint,
        expires, payload.nonce, "reviewer", "reviewer-key", "admin-fixture",
    ])
})
test.each(["PROD_DATABASE_URL", "DEV_DATABASE_URL", "TEST_DATABASE_URL"])("migration credentials reused through %s rejected", async variable => {
    const s = setup()
    s.env[variable] = local.replace("reader", "re%61der").replace("synthetic", "different-password")
    await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "MIGRATION_CREDENTIALS_REUSED" })
    expect(s.deps.createClient).not.toHaveBeenCalled()
})
test.each(["PROD_DATABASE_URL", "DEV_DATABASE_URL", "TEST_DATABASE_URL"])("ambiguous %s rejected before creating client", async variable => {
    const s = setup()
    s.env[variable] = "postgres://writer:private@127.0.0.1/isolated"
    await expect(run(s.args, s.env, s.deps)).rejects.toMatchObject({ code: "IDENTITY_COMPARISON_UNAVAILABLE" })
    expect(s.deps.createClient).not.toHaveBeenCalled()
})
