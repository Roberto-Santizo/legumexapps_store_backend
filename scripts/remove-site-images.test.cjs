"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const { argumentsOf, assertDestination, removeSiteImages, COLUMNS } = require("./remove-site-images.cjs")

test("site image cleanup requires an explicit mode and exact target", () => {
    assert.throws(() => argumentsOf([]), /Select --inspect or --apply/)
    assert.equal(argumentsOf(["--inspect", "--env-file", ".env", "--expected-host", "localhost", "--expected-database", "db"])["--inspect"], true)
    assert.throws(() => argumentsOf(["--inspect", "--apply", "--env-file", ".env", "--expected-host", "localhost", "--expected-database", "db"]), /Select --inspect or --apply/)
    assert.deepEqual(assertDestination("postgresql://user:pass@localhost:5432/db", "localhost", "db"), { host: "localhost", database: "db" })
    assert.throws(() => assertDestination("postgresql://user:pass@localhost:5432/other", "localhost", "db"), /exactly match/)
    assert.deepEqual(COLUMNS, ["altText", "createdAt", "id", "imageUrl", "slotKey", "updatedAt"])
})

test("site image cleanup deletes only its permission links and drops with RESTRICT in one transaction", async () => {
    const statements = []
    let removed = false
    const client = { async query(sql) {
        statements.push(sql)
        if (sql.includes("SELECT current_database()")) return { rows: [{ database: "db", table_name: removed ? null : "site_images", permissions: "permissions", role_permissions: "role_permissions", sequence: removed ? null : "site_images_id_seq" }] }
        if (sql.includes("SELECT a.attname AS name")) return { rows: COLUMNS.map(name => ({ name })) }
        if (sql.includes("count(*)::int AS count FROM public.site_images")) return { rows: [{ count: 3 }] }
        if (sql.includes("count(*)::int AS count FROM public.permissions")) return { rows: [{ count: removed ? 0 : 1 }] }
        if (sql.includes("count(*)::int AS count FROM public.role_permissions")) return { rows: [{ count: removed ? 0 : 2 }] }
        if (sql.includes("DROP TABLE IF EXISTS public.site_images RESTRICT")) removed = true
        return { rows: [] }
    } }
    const result = await removeSiteImages(client, "db", true)
    assert.equal(result.applied, true)
    assert.equal(result.before.rows, 3)
    assert.equal(result.before.roleLinks, 2)
    assert.ok(statements.includes("DELETE FROM public.permissions WHERE name='siteContent:edit'"))
    assert.ok(statements.includes("DROP TABLE IF EXISTS public.site_images RESTRICT"))
    assert.ok(statements.includes("DROP SEQUENCE IF EXISTS public.site_images_id_seq RESTRICT"))
    assert.equal(statements.at(-1), "COMMIT")
})
