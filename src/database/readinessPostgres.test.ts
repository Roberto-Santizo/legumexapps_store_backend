import { readFileSync } from "node:fs"
import path from "node:path"
import { PERMISSIONS } from "./accessControlPolicy"
import { diagnoseAccessControl, diagnosePackagingGroups } from "./readinessDiagnostics"
import { readReadinessSnapshots, ReadinessReadError, ReadinessQueryClient, ReadinessReadOptions } from "./readinessPostgres"

const SELECTS = [
    'SELECT id, name FROM public.permissions ORDER BY id',
    'SELECT id, name FROM public.roles ORDER BY id',
    'SELECT role_id, permission_id FROM public.role_permissions ORDER BY role_id, permission_id',
    'SELECT id, username, role_id FROM public.users ORDER BY id',
    'SELECT id, "displayName", "nameKey", "isActive" FROM public."packagingGroups" ORDER BY id',
    'SELECT id, "productVariantId", "packagingId", "optionGroup", "isActive", "isDefault", "optionGroupId" FROM public."productVariantUnitMaterials" ORDER BY id',
    'SELECT id, "productVariantId", "packagingId", "optionGroup", "isActive", "isDefault", "optionGroupId" FROM public."productVariantPalletMaterials" ORDER BY id',
    'SELECT id, "productVariantId", "packagingId", "optionGroup", "isActive", "isDefault" FROM public."productVariantIntermediateMaterials" ORDER BY id',
]
const VERIFY = "SELECT current_setting('transaction_isolation') AS transaction_isolation, current_setting('transaction_read_only') AS transaction_read_only"
const ORDER = ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "SET LOCAL statement_timeout = '5000ms'", "SET LOCAL lock_timeout = '1000ms'", VERIFY, ...SELECTS, "ROLLBACK"]
function settingsResult(isolation: unknown = "repeatable read", readOnly: unknown = "on") {
    return { command: "SELECT", fields: [{ name: "transaction_isolation" }, { name: "transaction_read_only" }], rowCount: 1,
        rows: [{ transaction_isolation: isolation, transaction_read_only: readOnly }] }
}
const options = { initialAdminUsername: "initial-admin" }
const material = { id: 1, productVariantId: 1, packagingId: 1, optionGroup: "Caja", isActive: true, isDefault: false }
function fixtureRows(): Record<string, unknown>[][] {
    return [
        PERMISSIONS.map((row, i) => ({ id: i + 1, name: row.name })),
        [{ id: 1, name: "Administrador" }],
        PERMISSIONS.map((_row, i) => ({ role_id: 1, permission_id: i + 1 })),
        [{ id: 1, username: "initial-admin", role_id: 1 }],
        [{ id: 1, displayName: "Caja", nameKey: "caja", isActive: false }],
        [{ ...material, optionGroupId: 1 }, { ...material, id: 2, packagingId: 2, optionGroupId: null, isActive: false }],
        [{ ...material, optionGroupId: 1 }],
        [{ ...material, optionGroup: null }],
    ]
}
function result(index: number, rows: Record<string, unknown>[] = fixtureRows()[index]) {
    const names = SELECTS[index].slice(7, SELECTS[index].indexOf(" FROM ")).replace(/"/g, "").split(", ")
    return { command: "SELECT", fields: names.map(name => ({ name })), rowCount: rows.length, rows }
}
function fake(responses: unknown[] = SELECTS.map((_sql, i) => result(i))) {
    const query = jest.fn(async (sql: string): Promise<unknown> => {
        if (sql === VERIFY) return settingsResult()
        const index = SELECTS.indexOf(sql)
        return index === -1 ? { command: sql.split(" ")[0], rows: [], fields: [], rowCount: null } : responses[index]
    })
    return { query, connect: jest.fn(), end: jest.fn(), release: jest.fn() }
}

test("exact transaction order, explicit columns, all reads, and rollback on success", async () => {
    const client = fake()
    const snapshot = await readReadinessSnapshots(client, options)
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(ORDER)
    expect(client.query.mock.calls.every(call => call.length === 1)).toBe(true)
    for (const [sql] of client.query.mock.calls) {
        expect(sql).not.toMatch(/\b(COMMIT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i)
        expect(sql).not.toMatch(/SELECT\s+\*|\bWHERE\b|password|information_schema|pg_catalog/i)
    }
    expect(client.connect).not.toHaveBeenCalled()
    expect(client.end).not.toHaveBeenCalled()
    expect(client.release).not.toHaveBeenCalled()
    expect(snapshot.access.initialAdminUsername).toBe("initial-admin")
    expect(snapshot.packaging.groups[0].isActive).toBe(false)
    expect(snapshot.packaging.associations).toHaveLength(4)
    expect(snapshot.packaging.associations.some(row => !row.isActive)).toBe(true)
    expect(snapshot.packaging.associations.find(row => row.level === "intermediate")).not.toHaveProperty("optionGroupId")
    expect(diagnoseAccessControl(snapshot.access).status).toBe("prepared")
    expect(diagnosePackagingGroups(snapshot.packaging)).toMatchObject({ status: "incomplete", pendingLegacy: [{ level: "unit", associationId: 2 }] })
})

test("empty tables are valid snapshots, leaving interpretation to pure diagnostics", async () => {
    const client = fake(SELECTS.map((_sql, i) => result(i, [])))
    const snapshot = await readReadinessSnapshots(client, { initialAdminUsername: undefined })
    expect(snapshot.access).toEqual({ permissions: [], roles: [], rolePermissions: [], users: [], initialAdminUsername: undefined })
    expect(snapshot.packaging).toEqual({ groups: [], associations: [] })
    expect(diagnoseAccessControl(snapshot.access).status).toBe("incomplete")
    expect(diagnosePackagingGroups(snapshot.packaging).status).toBe("prepared")
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(ORDER)
})

test.each([null, undefined, {}, { initialAdminUsername: null }, { initialAdminUsername: 1 }, { initialAdminUsername: "" }])("invalid options rejected before first query %#", async input => {
    const client = fake()
    await expect(readReadinessSnapshots(client, input as unknown as ReadinessReadOptions)).rejects.toMatchObject({ code: "INVALID_INPUT" })
    expect(client.query).not.toHaveBeenCalled()
})
test.each([null, undefined, {}, { query: "not a function" }])("invalid client rejected before queries %#", async client => {
    await expect(readReadinessSnapshots(client as unknown as ReadinessQueryClient, options)).rejects.toMatchObject({ code: "INVALID_INPUT" })
})

test.each(ORDER.slice(0, -1).map((sql, i) => [i, sql] as const))("failure at statement %i rolls back without partial result", async (index, failingSql) => {
    const client = fake()
    const base = client.query.getMockImplementation()!
    client.query.mockImplementation(async sql => {
        if (sql === failingSql) throw new Error("secret://credentials; SQL parameters password")
        return base(sql)
    })
    const error = await readReadinessSnapshots(client, options).catch(value => value)
    expect(error).toBeInstanceOf(ReadinessReadError)
    expect(error.code).toBe("QUERY_FAILED")
    expect(error).not.toHaveProperty("cause")
    expect(error).not.toHaveProperty("snapshots")
    expect(error.message).not.toMatch(/secret|credentials|password|SELECT|BEGIN/)
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([...ORDER.slice(0, index + 1), "ROLLBACK"])
})

test.each([["42P01", "MISSING_TABLE"], ["42703", "MISSING_COLUMN"], ["57014", "QUERY_FAILED"]])("driver %s becomes controlled %s", async (code, expected) => {
    const client = fake()
    client.query.mockRejectedValueOnce({ code, message: "secret://credentials", detail: "SELECT password", parameters: ["secret"] })
    const error = await readReadinessSnapshots(client, options).catch(value => value)
    expect(error.code).toBe(expected)
    expect(error.message).not.toMatch(/SELECT|password|secret:\/\//)
    expect(JSON.stringify(error)).not.toMatch(/parameters|credentials/)
    expect(client.query.mock.calls.at(-1)).toEqual(["ROLLBACK"])
})

test("rollback failure after success withholds all results", async () => {
    const client = fake()
    const base = client.query.getMockImplementation()!
    client.query.mockImplementation(async sql => {
        if (sql === "ROLLBACK") throw new Error("private connection url")
        return base(sql)
    })
    await expect(readReadinessSnapshots(client, options)).rejects.toMatchObject({ code: "ROLLBACK_FAILED", rollbackFailed: true })
})
test("rollback failure preserves primary controlled error and signals cleanup failure", async () => {
    const client = fake()
    client.query.mockRejectedValueOnce({ code: "42P01", message: "private" }).mockRejectedValueOnce(new Error("private cleanup"))
    await expect(readReadinessSnapshots(client, options)).rejects.toMatchObject({ code: "MISSING_TABLE", rollbackFailed: true })
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([ORDER[0], "ROLLBACK"])
})

test.each([null, undefined, [], {}, { rows: [] }, { ...result(0), rows: {} }, { ...result(0), fields: [] },
    { ...result(0), rowCount: -1 }, { ...result(0), command: "UPDATE" }, { ...result(0), rows: new Array(1), rowCount: 1 },
    { ...result(0), fields: new Array(2) }, result(0, [{ id: "1", name: "x" }]), result(0, [{ id: 1 }]),
    result(0, [{ id: 1, name: "x", password: "secret" }]),
])("malformed response or projection %# rejected with rollback", async response => {
    const responses = SELECTS.map((_sql, i) => result(i))
    const client = fake([response, ...responses.slice(1)])
    await expect(readReadinessSnapshots(client, options)).rejects.toMatchObject({ code: "INVALID_RESPONSE" })
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([...ORDER.slice(0, 5), "ROLLBACK"])
})

test.each([
    [1, { id: 0, name: "x" }], [2, { role_id: null, permission_id: 1 }],
    [3, { id: 1, username: "x", role_id: "1" }],
    [4, { id: 1, displayName: "x", nameKey: "x", isActive: "false" }],
    [5, { ...material, optionGroupId: undefined }], [6, { ...material, optionGroupId: 1, isDefault: 1 }],
    [7, { ...material, optionGroup: 1 }],
] as const)("invalid row in read %i rejected before diagnostics", async (index, row) => {
    const responses = SELECTS.map((_sql, i) => result(i))
    responses[index] = result(index, [row])
    const client = fake(responses)
    await expect(readReadinessSnapshots(client, options)).rejects.toMatchObject({ code: "INVALID_RESPONSE" })
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([...ORDER.slice(0, 5 + index), "ROLLBACK"])
})

test("snapshot copies rows instead of returning client-owned objects", async () => {
    const responses = SELECTS.map((_sql, i) => result(i))
    const client = fake(responses)
    const snapshot = await readReadinessSnapshots(client, options)
    responses[0].rows[0].name = "mutated after query"
    expect(snapshot.access.permissions[0].name).toBe(PERMISSIONS[0].name)
})

test("concurrent use of the same injected client rejected without interleaving", async () => {
    const client = fake()
    let resume!: () => void
    client.query.mockImplementationOnce(() => new Promise(resolve => { resume = () => resolve({}) }))
    const first = readReadinessSnapshots(client, options)
    await expect(readReadinessSnapshots(client, options)).rejects.toMatchObject({ code: "CLIENT_BUSY" })
    expect(client.query).toHaveBeenCalledTimes(1)
    resume()
    await first
    await readReadinessSnapshots(client, options)
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([...ORDER, ...ORDER])
})

test("module has only a type import; importing it does not touch configuration or drivers", () => {
    const source = readFileSync(path.join(__dirname, "readinessPostgres.ts"), "utf8")
    expect(source.match(/^import .*$/gm)).toEqual(['import type { AccessSnapshot, PackagingSnapshot, PackagingAssociationSnapshot } from "./readinessDiagnostics"'])
    expect(source).not.toMatch(/require\(|process\.|\.connect\(|\.end\(|new (Client|Pool|Sequelize)|console\./)
    jest.isolateModules(() => {
        expect(require("./readinessPostgres").readReadinessSnapshots).toBeInstanceOf(Function)
    })
})

test.each([
    ["prior READ COMMITTED transaction ignoring BEGIN", "read committed", "on"],
    ["prior read-write transaction ignoring BEGIN", "repeatable read", "off"],
    ["prior default read-write transaction", "read committed", "off"],
    ["unexpected isolation", "serializable", "on"],
    ["incorrect capitalization", "Repeatable Read", "on"],
    ["trailing spaces", "repeatable read ", "on"],
    ["incorrect read-only text", "repeatable read", "true"],
] as const)("rejects %s without data SELECTs", async (_label, isolation, readOnly) => {
    const client = fake()
    const base = client.query.getMockImplementation()!
    client.query.mockImplementation(sql => sql === VERIFY ? Promise.resolve(settingsResult(isolation, readOnly)) : base(sql))
    await expect(readReadinessSnapshots(client, options)).rejects.toMatchObject({ code: "TRANSACTION_NOT_ISOLATED", rollbackFailed: false })
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([...ORDER.slice(0, 4), "ROLLBACK"])
})

test.each([
    null, {}, { rows: [] }, { ...settingsResult(), fields: [] },
    { ...settingsResult(), rows: [], rowCount: 0 },
    { ...settingsResult(), rows: [...settingsResult().rows, ...settingsResult().rows], rowCount: 2 },
    { ...settingsResult(), rows: [{ transaction_isolation: "repeatable read" }] },
    settingsResult(null, "on"), settingsResult(1, "on"), settingsResult("repeatable read", true),
    { ...settingsResult(), rows: [{ ...settingsResult().rows[0], secret: "private" }] },
    { ...settingsResult(), rowCount: 2 }, { ...settingsResult(), command: "SHOW" },
    { ...settingsResult(), rows: new Array(1) }, { ...settingsResult(), fields: new Array(2) },
])("rejects malformed transaction verification %# without data SELECTs", async response => {
    const client = fake()
    const base = client.query.getMockImplementation()!
    client.query.mockImplementation(sql => sql === VERIFY ? Promise.resolve(response) : base(sql))
    await expect(readReadinessSnapshots(client, options)).rejects.toMatchObject({ code: "INVALID_RESPONSE" })
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([...ORDER.slice(0, 4), "ROLLBACK"])
})

test("verification query failure is controlled and stops before data reads", async () => {
    const client = fake()
    const base = client.query.getMockImplementation()!
    client.query.mockImplementation(async sql => {
        if (sql === VERIFY) throw { message: "private SQL and credentials", code: "57014" }
        return base(sql)
    })
    const error = await readReadinessSnapshots(client, options).catch(value => value)
    expect(error.code).toBe("QUERY_FAILED")
    expect(error.message).not.toMatch(/private|credentials|current_setting/)
    expect(error).not.toHaveProperty("cause")
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([...ORDER.slice(0, 4), "ROLLBACK"])
})

test("rollback failure preserves isolation error without exposing cleanup details", async () => {
    const client = fake()
    const base = client.query.getMockImplementation()!
    client.query.mockImplementation(async sql => {
        if (sql === VERIFY) return settingsResult("read committed", "off")
        if (sql === "ROLLBACK") throw new Error("private cleanup credentials")
        return base(sql)
    })
    await expect(readReadinessSnapshots(client, options)).rejects.toMatchObject({ code: "TRANSACTION_NOT_ISOLATED", rollbackFailed: true })
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([...ORDER.slice(0, 4), "ROLLBACK"])
})

test.each(["private error credentials", undefined, null, 42, false])("non-object driver failure %# remains controlled", async thrown => {
    const client = fake()
    const base = client.query.getMockImplementation()!
    client.query.mockImplementation(async sql => {
        if (sql === VERIFY) throw thrown
        return base(sql)
    })
    const error = await readReadinessSnapshots(client, options).catch(value => value)
    expect(error).toBeInstanceOf(ReadinessReadError)
    expect(error.code).toBe("QUERY_FAILED")
    expect(error.message).not.toMatch(/private|credentials/)
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([...ORDER.slice(0, 4), "ROLLBACK"])
})

test("matching effective properties cannot distinguish an already-open transaction", async () => {
    // Simulates BEGIN being ignored: identical settings are still accepted.
    // This demonstrates a contract limitation, not proof of a fresh transaction.
    const client = fake()
    client.query.mockResolvedValueOnce({ command: "BEGIN", rows: [], fields: [], rowCount: null, notice: "already in a transaction" })
    await expect(readReadinessSnapshots(client, options)).resolves.toHaveProperty("access")
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(ORDER)
})
