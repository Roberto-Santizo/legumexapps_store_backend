"use strict"
const fs = require("node:fs")
const path = require("node:path")

const COLUMNS = ["id", "slotKey", "imageUrl", "altText", "createdAt", "updatedAt"].sort()

function argumentsOf(args) {
    const options = {}
    for (let index = 0; index < args.length; index++) {
        const key = args[index]
        if (["--inspect", "--apply"].includes(key) && !options[key]) options[key] = true
        else if (["--env-file", "--expected-host", "--expected-database"].includes(key) && !options[key] && args[index + 1] && !args[index + 1].startsWith("--")) options[key] = args[++index]
        else throw Error("Invalid cleanup arguments")
    }
    if (!!options["--inspect"] === !!options["--apply"] || !options["--env-file"] || !options["--expected-host"] || !options["--expected-database"]) throw Error("Select --inspect or --apply and an explicit environment file, expected host and expected database")
    return options
}

function assertDestination(urlText, expectedHost, expectedDatabase) {
    let url
    try { url = new URL(urlText) } catch { throw Error("Invalid PostgreSQL destination") }
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    const database = decodeURIComponent(url.pathname.slice(1))
    if (!["postgres:", "postgresql:"].includes(url.protocol) || host !== expectedHost || database !== expectedDatabase) throw Error("Expected host and database must exactly match the selected connection")
    return { host, database }
}

async function inventory(client, expectedDatabase, lockTable = false) {
    const { rows: [objects] } = await client.query(`SELECT current_database() AS database,
        to_regclass('public.site_images')::text AS table_name,
        to_regclass('public.permissions')::text AS permissions,
        to_regclass('public.role_permissions')::text AS role_permissions,
        to_regclass('public.site_images_id_seq')::text AS sequence`)
    if (!objects || objects.database !== expectedDatabase) throw Error("Connected database does not match the approved destination")
    if (!objects.permissions || !objects.role_permissions) throw Error("Required access-control tables are missing")
    let rows = 0
    if (objects.table_name) {
        const { rows: columns } = await client.query(`SELECT a.attname AS name FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
            WHERE c.oid='public.site_images'::regclass AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`)
        if (JSON.stringify(columns.map(column => column.name).sort()) !== JSON.stringify(COLUMNS)) throw Error("The legacy site_images table does not match the retired module")
        if (lockTable) await client.query("LOCK TABLE public.site_images IN ACCESS EXCLUSIVE MODE")
        rows = Number((await client.query("SELECT count(*)::int AS count FROM public.site_images")).rows[0].count)
    }
    const permissions = Number((await client.query("SELECT count(*)::int AS count FROM public.permissions WHERE name='siteContent:edit'")).rows[0].count)
    const roleLinks = Number((await client.query(`SELECT count(*)::int AS count FROM public.role_permissions rp
        JOIN public.permissions p ON p.id=rp.permission_id WHERE p.name='siteContent:edit'`)).rows[0].count)
    return { table: !!objects.table_name, sequence: !!objects.sequence, rows, permissions, roleLinks }
}

async function removeSiteImages(client, expectedDatabase, apply = false) {
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY")
    try {
        await client.query("SET LOCAL lock_timeout = '5s'")
        await client.query("SET LOCAL statement_timeout = '30s'")
        if (apply) {
            await client.query("SELECT pg_advisory_xact_lock(174229, 2)")
            await client.query("LOCK TABLE public.permissions, public.role_permissions IN SHARE ROW EXCLUSIVE MODE")
        }
        const before = await inventory(client, expectedDatabase, apply)
        if (apply) {
            await client.query(`DELETE FROM public.role_permissions rp USING public.permissions p
                WHERE rp.permission_id=p.id AND p.name='siteContent:edit'`)
            await client.query("DELETE FROM public.permissions WHERE name='siteContent:edit'")
            await client.query("DROP TABLE IF EXISTS public.site_images RESTRICT")
            await client.query("DROP SEQUENCE IF EXISTS public.site_images_id_seq RESTRICT")
            const after = await inventory(client, expectedDatabase)
            if (after.table || after.sequence || after.permissions || after.roleLinks) throw Error("Landing image objects remain; cleanup rejected")
        }
        await client.query("COMMIT")
        return { applied: apply, database: expectedDatabase, before }
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
    }
}

async function main(args = process.argv.slice(2)) {
    const options = argumentsOf(args)
    const config = require("dotenv").parse(fs.readFileSync(path.resolve(options["--env-file"])))
    const destination = assertDestination(config.DATABASE_URL, options["--expected-host"], options["--expected-database"])
    const { parseDatabaseConnection } = require("../dist/config/databaseConnection")
    const target = parseDatabaseConnection(config.DATABASE_URL, "production", config.DATABASE_CA_CERT || undefined)
    const { Client } = require("pg")
    const client = new Client({ host: target.host, port: target.port, database: target.database, user: target.username,
        password: target.password, ssl: target.ssl, connectionTimeoutMillis: 10000, application_name: "legumex-remove-site-images" })
    try {
        await client.connect()
        const report = await removeSiteImages(client, destination.database, !!options["--apply"])
        console.log(JSON.stringify({ host: destination.host, ...report }, null, 2))
        return report
    } finally { await client.end() }
}

module.exports = { argumentsOf, assertDestination, inventory, removeSiteImages, COLUMNS }
if (require.main === module) main().catch(() => {
    console.error("Landing image cleanup failed. No successful cleanup is reported. Verify the explicit destination, database privileges and unexpected dependencies; any failed transaction is rolled back.")
    process.exitCode = 1
})
