import { syncReferenceData } from "./bootstrap"
import { ADMIN_ROLE_NAME, PERMISSIONS } from "./accessControlPolicy"
import { UNIT_CATALOG } from "../features/unit/constants/unitCatalog"

// Synthetic client: no database. Records every statement and answers the role/unit lookups.
function client({ roleActive = true, unitRows = [] as unknown[], failOn }: { roleActive?: boolean; unitRows?: unknown[]; failOn?: string } = {}) {
    const statements: { sql: string; values?: unknown[] }[] = []
    return {
        statements,
        async query(sql: string, values?: unknown[]) {
            statements.push({ sql, values })
            if (failOn && sql.includes(failOn)) throw Object.assign(new Error("postgres://secret"), { code: "23505" })
            if (sql.startsWith('SELECT id,"isActive" FROM public.roles')) return { rows: [{ id: 7, isActive: roleActive }] }
            if (sql.startsWith('SELECT id,"isActive" FROM public.units')) return { rows: unitRows }
            return { rows: [] }
        },
    }
}

describe("syncReferenceData (automatic release step)", () => {
    test("inserts missing permissions, the admin role, its grants and the unit catalog in one locked transaction", async () => {
        const db = client()
        await syncReferenceData(db)
        const sql = db.statements.map(statement => statement.sql)
        expect(sql[0]).toBe("BEGIN")
        expect(sql).toContain("SELECT pg_advisory_xact_lock(174226, 1)")
        expect(sql.at(-1)).toBe("COMMIT")
        expect(db.statements.filter(statement => statement.sql.startsWith("INSERT INTO public.permissions")).map(statement => statement.values?.[0]))
            .toEqual(PERMISSIONS.map(permission => permission.name))
        expect(db.statements.find(statement => statement.sql.startsWith("INSERT INTO public.roles"))?.values).toEqual([ADMIN_ROLE_NAME])
        expect(db.statements.find(statement => statement.sql.startsWith("INSERT INTO public.role_permissions"))?.values?.[0]).toBe(7)
        expect(sql.filter(statement => statement.startsWith("INSERT INTO public.units"))).toHaveLength(UNIT_CATALOG.length)
        expect(sql.every(statement => /ON CONFLICT|^SELECT|^SET|^BEGIN|^COMMIT|^INSERT INTO public.units/.test(statement))).toBe(true)
    })

    test("never reads, creates or changes users", async () => {
        const db = client()
        await syncReferenceData(db)
        expect(db.statements.some(statement => /public\.users/.test(statement.sql))).toBe(false)
    })

    test("existing units are left untouched", async () => {
        const db = client({ unitRows: [{ id: 1, isActive: true }] })
        await syncReferenceData(db)
        expect(db.statements.some(statement => statement.sql.startsWith("INSERT INTO public.units"))).toBe(false)
    })

    test.each([
        ["an inactive admin role", { roleActive: false }],
        ["an inactive catalog unit", { unitRows: [{ id: 1, isActive: false }] }],
        ["a failing statement", { failOn: "role_permissions" }],
    ])("rolls back and reports a safe error for %s", async (_label, options) => {
        const db = client(options)
        await expect(syncReferenceData(db)).rejects.toThrow(/^Reference data sync rejected at \w+ \((?:validation|23505)\); changes rolled back/)
        expect(db.statements.at(-1)?.sql).toBe("ROLLBACK")
        expect(db.statements.some(statement => statement.sql === "COMMIT")).toBe(false)
    })
})
