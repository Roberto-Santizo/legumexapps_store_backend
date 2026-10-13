const fs = require('node:fs/promises')
require('reflect-metadata')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { run, safeError } = require('./migrate.cjs')
async function main(args, env) {
    await require('./build-integrity.cjs').run('verify')
    const { bootstrapDatabase, validateBootstrapCredentials } = require('../dist/database/bootstrap.js')
    const { assertDatabaseReady, assertSchemaReady } = require('../dist/database/schemaReadiness.js')
    const { databaseModels } = require('../dist/database/models.js')
    const { Sequelize } = require('sequelize-typescript')
    const credentials = { username: env.BOOTSTRAP_ADMIN_USERNAME, password: env.BOOTSTRAP_ADMIN_PASSWORD }
    validateBootstrapCredentials(credentials)
    const artifact = createHash('sha256').update(await fs.readFile(path.resolve(__dirname, '../dist/.build-integrity')))
        .update(JSON.stringify([credentials.username, createHash('sha256').update(credentials.password).digest('hex')])).digest('hex')
    const metadata = new Sequelize({ dialect: 'postgres', logging: false, models: databaseModels })
    try {
        await run(args, env, { administrativeOperation: { name: 'bootstrap', artifact, execute: async client => {
            await assertSchemaReady(client, metadata)
            await bootstrapDatabase(client, credentials)
            await assertDatabaseReady(client, metadata)
        } } })
    } finally { await metadata.close() }
}
module.exports = { main }
if (require.main === module) main(process.argv.slice(2), process.env).catch(error => {
    console.error(safeError(error))
    process.exitCode = 1
})
