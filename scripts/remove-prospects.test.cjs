const { test } = require("node:test")
const assert = require("node:assert/strict")
const { argumentsOf, assertDestination, removeProspects, LEAD_COLUMNS } = require("./remove-prospects.cjs")

function fixture({ failDrop = false, unexpectedColumns = false, database = "synthetic" } = {}) {
    const calls = []
    let removed = false
    const client = { async query(sql) {
        calls.push(sql)
        if (sql.startsWith("SELECT current_database")) return { rows: [{ database, permissions: "permissions", role_permissions: "role_permissions", leads: removed ? null : "leads", status_type: removed ? null : "enum_leads_status", sequence: removed ? null : "leads_id_seq" }] }
        if (sql.includes("FROM pg_attribute")) return { rows: (unexpectedColumns ? [...LEAD_COLUMNS, "unrelatedData"] : LEAD_COLUMNS).map(name => ({ name })) }
        if (sql.startsWith("SELECT count")) return { rows: [{ count: removed ? 0 : 3 }] }
        if (sql.startsWith("DROP TABLE")) { if (failDrop) throw Error("Synthetic dependency prevents drop"); removed = true }
        return { rows: [] }
    } }
    return { client, calls }
}

test("a cleanup requires an explicit mode, environment file and matching approved destination", () => {
    assert.throws(() => argumentsOf([]))
    assert.throws(() => argumentsOf(["--apply", "--inspect", "--env-file", "x", "--expected-host", "localhost", "--expected-database", "synthetic"]))
    const args = argumentsOf(["--inspect", "--env-file", "x", "--expected-host", "localhost", "--expected-database", "synthetic"])
    assert.equal(args["--inspect"], true)
    assert.deepEqual(assertDestination("postgres://test:test@localhost:5432/synthetic", "localhost", "synthetic"), { host: "localhost", database: "synthetic" })
    assert.throws(() => assertDestination("postgres://test:test@localhost:5432/other", "localhost", "synthetic"))
    assert.throws(() => assertDestination("postgres://test:test@remote.invalid:5432/synthetic", "localhost", "synthetic"))
})

test("inspection runs read-only and reports counts without exposing contact data or deleting anything", async () => {
    const { client, calls } = fixture()
    const report = await removeProspects(client, "synthetic")
    assert.equal(calls[0], "BEGIN READ ONLY")
    assert.equal(report.applied, false)
    assert.deepEqual(report.before, { table: true, statusType: true, sequence: true, leads: 3, permissions: 3, roleLinks: 3 })
    assert.ok(!calls.some(sql => /^(DELETE|DROP|LOCK)/.test(sql)))
    assert.equal(calls.at(-1), "COMMIT")
})

test("apply deletes only prospect permissions/links and drops only the retired table, sequence and enum", async () => {
    const { client, calls } = fixture()
    const report = await removeProspects(client, "synthetic", true)
    assert.equal(report.applied, true)
    assert.ok(calls.some(sql => sql.includes("LOCK TABLE public.permissions")))
    const mutations = calls.filter(sql => /^(DELETE|DROP)/.test(sql))
    assert.equal(mutations.length, 5)
    assert.ok(mutations.filter(sql => sql.startsWith("DELETE")).every(sql => sql.includes("p.name LIKE 'leads:%'") || sql.includes("WHERE name LIKE 'leads:%'")))
    assert.deepEqual(mutations.filter(sql => sql.startsWith("DROP")), ["DROP TABLE IF EXISTS public.leads RESTRICT", "DROP SEQUENCE IF EXISTS public.leads_id_seq RESTRICT", "DROP TYPE IF EXISTS public.enum_leads_status RESTRICT"])
    assert.ok(!mutations.some(sql => sql.includes("CASCADE")))
    assert.equal(calls.at(-1), "COMMIT")
})

test("unexpected dependencies roll back permission deletions and prevent a successful cleanup report", async () => {
    const { client, calls } = fixture({ failDrop: true })
    await assert.rejects(removeProspects(client, "synthetic", true), /dependency/)
    assert.equal(calls.at(-1), "ROLLBACK")
    assert.ok(!calls.includes("COMMIT"))
})

test("repeating an applied cleanup is safe when the legacy objects and permissions are already absent", async () => {
    const { client } = fixture()
    await removeProspects(client, "synthetic", true)
    const repeated = await removeProspects(client, "synthetic", true)
    assert.deepEqual(repeated.before, { table: false, statusType: false, sequence: false, leads: 0, permissions: 0, roleLinks: 0 })
})

test("a mismatched database or unexpected table layout is rejected before deleting records", async () => {
    for (const options of [{ database: "other" }, { unexpectedColumns: true }]) {
        const { client, calls } = fixture(options)
        await assert.rejects(removeProspects(client, "synthetic", true))
        assert.ok(!calls.some(sql => /^(DELETE|DROP)/.test(sql)))
        assert.equal(calls.at(-1), "ROLLBACK")
    }
})
