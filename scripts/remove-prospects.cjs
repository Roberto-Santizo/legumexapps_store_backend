"use strict"
const fs = require("node:fs")
const path = require("node:path")

const LEAD_COLUMNS = ["id", "fullName", "companyName", "phone", "email", "productLineInterest", "notes", "status", "createdAt", "updatedAt"].sort()
const OBJECTS_SQL = `SELECT current_database() AS database,
    to_regclass('public.leads')::text AS leads,
    to_regclass('public.permissions')::text AS permissions,
    to_regclass('public.role_permissions')::text AS role_permissions,
    to_regtype('public.enum_leads_status')::text AS status_type,
    to_regclass('public.leads_id_seq')::text AS sequence`

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
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !expectedHost || !expectedDatabase || host !== expectedHost || database !== expectedDatabase) throw Error("Expected host and database must exactly match the selected connection")
    return { host, database }
}

async function inventory(client, expectedDatabase, lockLeads = false) {
    const { rows: [objects] } = await client.query(OBJECTS_SQL)
    if (!objects || objects.database !== expectedDatabase) throw Error("Connected database does not match the approved destination")
    if (!objects.permissions || !objects.role_permissions) throw Error("Required access-control tables are missing")
    let leads = 0
    if (objects.leads) {
        const { rows: columns } = await client.query(`SELECT a.attname AS name FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
            WHERE c.oid='public.leads'::regclass AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`)
        if (JSON.stringify(columns.map(column => column.name).sort()) !== JSON.stringify(LEAD_COLUMNS)) throw Error("The legacy leads table does not match the retired module")
        if (lockLeads) await client.query("LOCK TABLE public.leads IN ACCESS EXCLUSIVE MODE")
        leads = Number((await client.query("SELECT count(*)::int AS count FROM public.leads")).rows[0].count)
    }
    const permissions = Number((await client.query("SELECT count(*)::int AS count FROM public.permissions WHERE name LIKE 'leads:%'")).rows[0].count)
    const links = Number((await client.query(`SELECT count(*)::int AS count FROM public.role_permissions rp
        JOIN public.permissions p ON p.id=rp.permission_id WHERE p.name LIKE 'leads:%'`)).rows[0].count)
    return { table: !!objects.leads, statusType: !!objects.status_type, sequence: !!objects.sequence, leads, permissions, roleLinks: links }
}

async function removeProspects(client, expectedDatabase, apply = false) {
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY")
    try {
        await client.query("SET LOCAL lock_timeout = '5s'")
        await client.query("SET LOCAL statement_timeout = '30s'")
        if (apply) {
            await client.query("SELECT pg_advisory_xact_lock(174229, 1)")
            await client.query("LOCK TABLE public.permissions, public.role_permissions IN SHARE ROW EXCLUSIVE MODE")
        }
        const before = await inventory(client, expectedDatabase, apply)
        if (apply) {
            await client.query(`DELETE FROM public.role_permissions rp USING public.permissions p
                WHERE rp.permission_id=p.id AND p.name LIKE 'leads:%'`)
            await client.query("DELETE FROM public.permissions WHERE name LIKE 'leads:%'")
            // RESTRICT preserves unexpected references; a failure rolls back the entire cleanup.
            await client.query("DROP TABLE IF EXISTS public.leads RESTRICT")
            await client.query("DROP SEQUENCE IF EXISTS public.leads_id_seq RESTRICT")
            await client.query("DROP TYPE IF EXISTS public.enum_leads_status RESTRICT")
            const after = await inventory(client, expectedDatabase)
            if (after.table || after.statusType || after.sequence || after.permissions || after.roleLinks) throw Error("Legacy prospect objects remain; cleanup rejected")
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
    // Use the application's verified TLS parser without loading its server or connecting Sequelize.
    const { parseDatabaseConnection } = require("../dist/config/databaseConnection")
    const target = parseDatabaseConnection(config.DATABASE_URL, "production", config.DATABASE_CA_CERT || undefined)
    const { Client } = require("pg")
    const client = new Client({ host: target.host, port: target.port, database: target.database, user: target.username,
        password: target.password, ssl: target.ssl, connectionTimeoutMillis: 10000, application_name: "legumex-remove-prospects" })
    try {
        await client.connect()
        const report = await removeProspects(client, destination.database, !!options["--apply"])
        console.log(JSON.stringify({ host: destination.host, ...report }, null, 2))
        return report
    } finally { await client.end() }
}

module.exports = { argumentsOf, assertDestination, inventory, removeProspects, LEAD_COLUMNS }
if (require.main === module) main().catch(() => {
    console.error("Prospect cleanup failed. No successful cleanup is reported. Verify the explicit destination, database privileges and unexpected dependencies; any failed transaction is rolled back.")
    process.exitCode = 1
})
