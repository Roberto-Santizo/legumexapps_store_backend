"use strict"
// prestart verifies artifacts only. Startup checks the database in a read-only transaction.
async function main(_env, { verifyBuild = () => require('./build-integrity.cjs').run('verify') } = {}) {
    try { await verifyBuild() } catch { throw new Error('Build missing, changed or stale. Run npm run build before npm start. No database operation was attempted.') }
}
module.exports = { main }
if (require.main === module) main(process.env).catch(error => { console.error(error.message); process.exitCode=1 })
