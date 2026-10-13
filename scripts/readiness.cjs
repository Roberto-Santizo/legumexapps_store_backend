const fs = require('node:fs/promises')
const path = require('node:path')
const { isIP } = require('node:net')
const { createApprovalRequest, verifyApproval, ApprovalError } = require('./readiness-approval.cjs')
// Importing this module does not run migrations; only the exported guard is used.
const { destination, parseDestination } = require('./migrate.cjs')

class ReadinessCommandError extends Error {
    constructor(code, { closeFailed = false, rollbackFailed = false } = {}) {
        super(`Readiness diagnostic failed: ${code}${closeFailed ? '; client close failed' : ''}${rollbackFailed ? '; rollback failed' : ''}; sensitive details suppressed`)
        this.name = 'ReadinessCommandError'
        this.code = code
        this.closeFailed = closeFailed
        this.rollbackFailed = rollbackFailed
    }
}
const fail = code => { throw new ReadinessCommandError(code) }
const adapterCodes = new Set(['INVALID_INPUT', 'CLIENT_BUSY', 'INVALID_RESPONSE', 'MISSING_TABLE', 'MISSING_COLUMN', 'QUERY_FAILED', 'ROLLBACK_FAILED', 'TRANSACTION_NOT_ISOLATED'])
const accessCodes = new Set(['duplicate_permission', 'duplicate_role', 'duplicate_user', 'duplicate_role_permission', 'dangling_role_permission', 'dangling_user_role'])
const packagingCodes = new Set(['duplicate_group_id', 'invalid_group_key', 'duplicate_normalized_group', 'duplicate_association_id', 'duplicate_variant_packaging', 'unexpected_intermediate_group_id', 'missing_group_id', 'invalid_legacy_group', 'dangling_group_reference', 'group_label_mismatch', 'active_association_inactive_group', 'multiple_active_defaults'])

function options(args) {
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) fail('INVALID_ARGUMENTS')
    const result = Object.create(null)
    for (let index = 0; index < args.length; index++) {
        const key = args[index]
        if (!['--env', '--initial-admin-username', '--plan', '--expires', '--approval', '--approver-id', '--key-id'].includes(key) || key in result) fail('INVALID_ARGUMENTS')
        if (key === '--plan') { result[key] = true; continue }
        const value = args[++index]
        if (!value || value.startsWith('--')) fail('INVALID_ARGUMENTS')
        result[key] = value
    }
    if (!['development', 'test', 'production'].includes(result['--env'])) fail('EXPLICIT_ENV_REQUIRED')
    return result
}

function checkApproval(opts, fingerprint, now, trustedApprovers) {
    try {
        verifyApproval(opts['--approval'], { targetFingerprint: fingerprint, expires: opts['--expires'],
            initialAdminUsername: opts['--initial-admin-username'] ?? null, trustedApprovers, now })
    } catch (error) {
        fail(error instanceof ApprovalError ? error.code : 'APPROVAL_MALFORMED')
    }
}
function connectionIdentity(url) {
    if (typeof url !== 'string' || !url || /[\x00-\x20\\]/.test(url)) fail('IDENTITY_COMPARISON_UNAVAILABLE')
    let config
    try { config = parseDestination(url).config } catch { fail('IDENTITY_COMPARISON_UNAVAILABLE') }
    let host = config.host.toLowerCase()
    if (host.endsWith('.')) host = host.slice(0, -1)
    const ip = isIP(host)
    if (!ip && (host.includes(':') || /^[0-9.]+$/.test(host) || host.length > 253
        || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) fail('IDENTITY_COMPARISON_UNAVAILABLE')
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) fail('IDENTITY_COMPARISON_UNAVAILABLE')
    // User/database are case-sensitive PostgreSQL identities; passwords are irrelevant.
    return JSON.stringify([config.user, host, config.port, config.database])
}

async function loadPolicy() {
    try { return JSON.parse(await fs.readFile(path.join(__dirname, 'migration-targets.json'), 'utf8')) }
    catch { fail('TARGET_POLICY_UNAVAILABLE') }
}
async function loadRuntime() {
    try {
        await require('./build-integrity.cjs').run('verify')
        const { readReadinessSnapshots, ReadinessReadError } = require('../dist/database/readinessPostgres.js')
        const { diagnoseAccessControl, diagnosePackagingGroups } = require('../dist/database/readinessDiagnostics.js')
        return { readReadinessSnapshots, ReadinessReadError, diagnoseAccessControl, diagnosePackagingGroups }
    } catch { fail('BUILD_UNAVAILABLE') }
}

function reportFor(access, packaging) {
    const states = ['prepared', 'incomplete', 'inconsistent']
    if (!states.includes(access?.status) || !states.includes(packaging?.status)) fail('DIAGNOSTIC_FAILED')
    const accessFindings = access.issues.map(code => {
        if (!accessCodes.has(code)) fail('DIAGNOSTIC_FAILED')
        return { code, severity: 'error' }
    })
    for (const [key, code, severity] of [
        ['missingPermissions', 'missing_permissions', 'warning'],
        ['missingExpectedAssignments', 'missing_expected_assignments', 'warning'],
        ['additionalAssignments', 'additional_assignments', 'info'],
        ['unassignedDatabasePermissions', 'unassigned_database_permissions', 'warning'],
    ]) {
        if (access[key].length) accessFindings.push({ code, severity, count: access[key].length })
    }
    if (access.adminRoleCount !== 1) accessFindings.push({ code: 'administrator_role_count', severity: access.adminRoleCount ? 'error' : 'warning', count: access.adminRoleCount })
    const adminStates = ['not_specified', 'missing', 'ambiguous', 'present_admin_role', 'present_other_role']
    if (!adminStates.includes(access.initialAdmin)) fail('DIAGNOSTIC_FAILED')
    accessFindings.push({ code: `initial_admin_${access.initialAdmin}`, severity: access.initialAdmin === 'ambiguous' ? 'error' : ['missing', 'present_other_role'].includes(access.initialAdmin) ? 'warning' : 'info' })
    const counts = new Map()
    for (const finding of packaging.findings) {
        if (!packagingCodes.has(finding.code)) fail('DIAGNOSTIC_FAILED')
        const severity = finding.code === 'active_association_inactive_group' ? 'info' : finding.code === 'missing_group_id' ? 'warning' : 'error'
        const item = counts.get(finding.code) ?? { code: finding.code, severity, count: 0 }
        item.count++
        counts.set(finding.code, item)
    }
    // Deliberately omit usernames, permission names, row IDs and raw snapshots.
    return {
        access: { status: access.status, findings: accessFindings, authenticationVerified: false },
        packaging: { status: packaging.status, findings: [...counts.values()], calculationVerified: false },
        schemaCompatibility: 'unknown', repairsPerformed: false,
    }
}

async function run(args, env, { createClient = config => new (require('pg').Client)(config), targetPolicy, runtimeLoader = loadRuntime, now = Date.now, trustedApprovers = [] } = {}) {
    const opts = options(args)
    if (opts['--env'] !== 'production' && (opts['--plan'] || opts['--expires'] || opts['--approval'] || opts['--approver-id'] || opts['--key-id'])) fail('PRODUCTION_OPTIONS_REQUIRED')
    if (opts['--plan'] && opts['--approval']) fail('INVALID_ARGUMENTS')
    if (!env || typeof env !== 'object' || Array.isArray(env)) fail('INVALID_CONFIGURATION')
    if ([...Object.keys(process.env), ...Object.keys(env)].some(key => /^PG/i.test(key))) fail('PG_VARIABLES_FORBIDDEN')
    const prefix = { development: 'DEV', test: 'TEST', production: 'PROD' }[opts['--env']]
    const url = env[`READINESS_${prefix}_DATABASE_URL`]
    const pin = env[`READINESS_${prefix}_TARGET_SHA256`]
    if (typeof url !== 'string' || !url || typeof pin !== 'string' || !/^[a-f0-9]{64}$(?![\s\S])/.test(pin)) fail('INVALID_CONFIGURATION')
    const identity = connectionIdentity(url)
    for (const variable of ['DATABASE_URL', 'PROD_DATABASE_URL', 'DEV_DATABASE_URL', 'TEST_DATABASE_URL']) {
        if (Object.prototype.hasOwnProperty.call(env, variable) && identity === connectionIdentity(env[variable])) fail(variable === 'DATABASE_URL' ? 'BACKEND_CREDENTIALS_REUSED' : 'MIGRATION_CREDENTIALS_REUSED')
    }
    const policy = targetPolicy ?? await loadPolicy()
    let target
    try {
        target = destination(opts['--env'], { ...env, [`${prefix}_DATABASE_URL`]: url, [`${prefix}_MIGRATION_TARGET_SHA256`]: pin }, policy)
        const record = policy.targets.find(row => row.fingerprint === target.fingerprint)
        if (record.readOnlyCredentialsVerified !== true) fail('READ_ONLY_REVIEW_REQUIRED')
        if (!Number.isInteger(target.config.port) || target.config.port < 1 || target.config.port > 65535) fail('INVALID_CONFIGURATION')
    } catch (error) {
        if (error instanceof ReadinessCommandError) throw error
        fail('DESTINATION_REJECTED')
    }
    if (opts['--env'] === 'production') {
        if (opts['--plan']) {
            let request
            try { request = createApprovalRequest({ targetFingerprint: target.fingerprint, expires: opts['--expires'],
                approverId: opts['--approver-id'], keyId: opts['--key-id'], initialAdminUsername: opts['--initial-admin-username'] ?? null }, now()) }
            catch (error) { fail(error instanceof ApprovalError ? error.code : 'APPROVAL_MALFORMED') }
            return { operation: 'readiness-production-plan', offline: true, targetFingerprint: target.fingerprint,
                expires: request.expires, approvalRequest: request, approvalMeaning: 'Unsigned request; independent Ed25519 approval required' }
        }
        checkApproval(opts, target.fingerprint, now(), trustedApprovers)
    }
    // No client is created until all destination, option and artifact checks pass.
    let runtime
    try { runtime = await runtimeLoader() }
    catch { fail('BUILD_UNAVAILABLE') }
    if (!runtime || ['readReadinessSnapshots', 'ReadinessReadError', 'diagnoseAccessControl', 'diagnosePackagingGroups'].some(key => typeof runtime[key] !== 'function')) fail('BUILD_UNAVAILABLE')
    if (opts['--env'] === 'production') checkApproval(opts, target.fingerprint, now(), trustedApprovers)
    let client
    try {
        client = createClient({ ...target.config, application_name: 'legumex-readiness', connectionTimeoutMillis: 10000, query_timeout: 10000 })
    } catch { fail('CLIENT_CREATION_FAILED') }
    let clientError = false, failure, report
    try {
        // Listener remains installed through end(); never log driver event payloads.
        client.on('error', () => { clientError = true })
        await client.connect()
        if (clientError) fail('CLIENT_FAILED')
        const snapshots = await runtime.readReadinessSnapshots(client, { initialAdminUsername: opts['--initial-admin-username'] })
        if (clientError) fail('CLIENT_FAILED')
        report = reportFor(runtime.diagnoseAccessControl(snapshots.access), runtime.diagnosePackagingGroups(snapshots.packaging))
    } catch (error) {
        if (error instanceof ReadinessCommandError) failure = error
        else if (error instanceof runtime.ReadinessReadError && adapterCodes.has(error.code)) failure = new ReadinessCommandError(error.code, { rollbackFailed: error.rollbackFailed === true })
        else failure = new ReadinessCommandError('OPERATION_FAILED')
    } finally {
        try { await client.end() }
        catch { failure = new ReadinessCommandError(failure?.code ?? 'CLIENT_CLOSE_FAILED', { closeFailed: true, rollbackFailed: failure?.rollbackFailed === true }) }
    }
    if (failure) throw failure
    if (clientError) fail('CLIENT_FAILED')
    return report
}

module.exports = { run, ReadinessCommandError }
if (require.main === module) run(process.argv.slice(2), process.env).then(report => {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exitCode = report.offline || (report.access.status === 'prepared' && report.packaging.status === 'prepared') ? 0 : 2
}).catch(error => {
    // Even unexpected exceptions are reduced to fixed output, never an error object.
    console.error(error instanceof ReadinessCommandError ? error.message : 'Readiness diagnostic failed; sensitive details suppressed')
    process.exitCode = 1
})
