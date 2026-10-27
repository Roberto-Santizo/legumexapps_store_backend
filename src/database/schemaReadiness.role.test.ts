import { assertApplicationRole } from "./schemaReadiness"
import { parseDatabaseRolePolicy } from "../config/databaseRolePolicy"

const limited = { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, schema_create: false, table_truncate: false, transaction_mode: "on" }
const client = (overrides = {}) => ({ query: jest.fn().mockResolvedValue({ rows: [{ ...limited, ...overrides }] }) })

test("restricted remains the default; owner acceptance requires an exact explicit setting", () => {
    expect(parseDatabaseRolePolicy(undefined)).toBe("restricted")
    expect(parseDatabaseRolePolicy("restricted")).toBe("restricted")
    expect(parseDatabaseRolePolicy("owner")).toBe("owner")
    for (const value of ["", "true", "Owner", "owner ", " owner", "owner\n"]) expect(() => parseDatabaseRolePolicy(value)).toThrow()
})

test("owner policy accepts schema ownership and managed role-management privileges", async () => {
    const owner = { schema_create: true, table_truncate: true, rolcreatedb: true, rolcreaterole: true }
    await expect(assertApplicationRole(client(owner))).rejects.toThrow()
    await expect(assertApplicationRole(client(owner), "owner")).resolves.toBeUndefined()
    await expect(assertApplicationRole(client(), "restricted")).resolves.toBeUndefined()
})

test.each(["rolsuper", "rolreplication", "rolbypassrls"])("owner acceptance still rejects %s", async key => {
    await expect(assertApplicationRole(client({ [key]: true }), "owner")).rejects.toThrow()
})

test("both policies require a real read-only transaction and well-formed role metadata", async () => {
    for (const policy of ["restricted", "owner"] as const) {
        for (const changes of [{ transaction_mode: "off" }, { table_truncate: null }, { rolcreatedb: "false" }]) {
            await expect(assertApplicationRole(client(changes), policy)).rejects.toThrow()
        }
        await expect(assertApplicationRole({ query: async () => ({ rows: [] }) }, policy)).rejects.toThrow()
    }
})
