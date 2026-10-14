"use strict"
// Runs on every `npm start` (prestart), i.e. on each Render deploy before the server starts:
// 1. verifies the sealed build, 2. applies pending incremental migrations (scripts/migrate.cjs deploy),
// 3. syncs code-defined permissions and units (never users). Any failure exits non-zero so the new
// version never starts serving. Deliberately does not load dotenv: the platform supplies the env.
const { run: integrity } = require("./build-integrity.cjs")
const { deploy, safeError } = require("./migrate.cjs")

async function main(env, { verifyBuild = () => integrity("verify"), loadSync = () => require("../dist/database/bootstrap.js").syncReferenceData, ...deployOptions } = {}) {
    try { await verifyBuild() } catch {
        throw new Error("Build missing, changed or stale. Run npm run build successfully before npm start. No migration was attempted.")
    }
    const syncReferenceData = loadSync()
    await deploy(env, { ...deployOptions, afterMigrate: client => syncReferenceData(client) })
}

module.exports = { main }
if (require.main === module) main(process.env).catch(error => {
    // Driver errors may contain credentials, SQL or connection strings.
    console.error(error?.message?.startsWith("Build missing") ? error.message : safeError(error))
    process.exitCode = 1
})
