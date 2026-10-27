import { assertNoUnexpectedBehavior, assertPostgresCapabilities } from "./schemaReadiness"

test.each(["140012", "130020", "", "invalid", null])("rejects unsupported or unavailable PostgreSQL version %j before catalog inspection", async version => {
    const query = jest.fn().mockResolvedValue({ rows: [{ version }] })
    await expect(assertPostgresCapabilities({ query })).rejects.toThrow("PostgreSQL 15 or newer")
    expect(query).toHaveBeenCalledTimes(1)
})
test.each(["150000", "170006", "180000"])("accepts the supported catalog version %s", async version => {
    await expect(assertPostgresCapabilities({ query: async () => ({ rows: [{ version }] }) })).resolves.toBeUndefined()
})
test.each(["rule", "row security", "RLS policy", "event trigger", "column collation"])("blocks unexpected %s", async kind => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ readable: true }] }).mockResolvedValueOnce({ rows: [{ kind }] })
    await expect(assertNoUnexpectedBehavior({ query })).rejects.toThrow(kind)
})
test("requires readable catalogs and sanitizes failed inspections", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ readable: false }] })
    await expect(assertNoUnexpectedBehavior({ query })).rejects.toThrow("catalogs are not readable")
    expect(query).toHaveBeenCalledTimes(1)
    await expect(assertNoUnexpectedBehavior({ query: async () => { throw Error("private diagnostic") } })).rejects.toThrow("metadata could not be inspected")
})
test("inspection uses only catalog SELECTs and checks event triggers across all schemas", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ readable: true }] }).mockResolvedValueOnce({ rows: [] })
    await expect(assertNoUnexpectedBehavior({ query })).resolves.toBeUndefined()
    for (const [sql] of query.mock.calls) expect(sql.trim()).toMatch(/^SELECT /)
    expect(query.mock.calls[1][0]).toContain("UNION ALL SELECT 'event trigger' FROM pg_catalog.pg_event_trigger")
})
