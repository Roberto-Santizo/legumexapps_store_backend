// Read-only predeployment audit. Does not initialize Sequelize or run seeders/sync.
const fs = require("node:fs")
const path = require("node:path")
const { Client } = require("pg")
require("dotenv").config({ path: path.resolve(__dirname, "../src/config/.env"), quiet: true })

async function main() {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_MISSING")
    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
        options: "-c default_transaction_read_only=on -c statement_timeout=10000" })
    try {
        await client.connect()
        await client.query("BEGIN READ ONLY")
        const { rows: columns } = await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name IN ('packagings', 'productVariantPalletMaterials')`)
        const has = (table, column) => columns.some(row => row.table_name === table && row.column_name === column)
        const required = [["packagings", "code"], ["packagings", "packagingRole"], ["productVariantPalletMaterials", "quantityBasis"], ["productVariantPalletMaterials", "quantityValue"]]
        const missing = required.filter(([table, column]) => !has(table, column)).map(([table, column]) => `${table}.${column}`)
        const report = { auditedAt: new Date().toISOString(), readOnly: true, missingPrerequisites: missing,
            catalogDefaultsColumnsPresent: has("packagings", "defaultQuantityBasis") && has("packagings", "defaultQuantityValue"), summary: {}, rows: [] }
        if (missing.length === 0) {
            let query = fs.readFileSync(path.resolve(__dirname, "../docs/packaging-consumption-audit.sql"), "utf8")
            if (!has("packagings", "defaultQuantityBasis")) query = query.replace('p."defaultQuantityBasis"', 'NULL AS "defaultQuantityBasis"')
            if (!has("packagings", "defaultQuantityValue")) query = query.replace('p."defaultQuantityValue"', 'NULL AS "defaultQuantityValue"')
            report.rows = (await client.query(query)).rows
            report.summary = report.rows.reduce((counts, row) => { counts[row.status] = (counts[row.status] ?? 0) + 1; return counts }, {})
        }
        await client.query("COMMIT")
        fs.writeFileSync(path.resolve(__dirname, "../docs/packaging-consumption-audit-result.json"), JSON.stringify(report, null, 2) + "\n")
        console.log(JSON.stringify({ auditedAt: report.auditedAt, readOnly: true, missingPrerequisites: missing, catalogDefaultsColumnsPresent: report.catalogDefaultsColumnsPresent, summary: report.summary, materials: report.rows.length }))
    } finally { await client.end() }
}
main().catch(error => {
    // Never print connection strings, environment, credentials, or server detail.
    console.error(JSON.stringify({ auditFailed: true, code: error.code ?? (error.message === "DATABASE_URL_MISSING" ? error.message : "AUDIT_ERROR") }))
    process.exitCode = 1
})
