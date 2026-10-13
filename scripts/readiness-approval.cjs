const { randomBytes, verify, KeyObject } = require('node:crypto')
const DOMAIN = 'LEGUMEX/readiness-production-approval'
const VERSION = 2
const MAX_LIFETIME_MS = 15 * 60 * 1000
const keys = ['domain', 'version', 'environment', 'targetFingerprint', 'expires', 'nonce', 'approverId', 'keyId', 'initialAdminUsername']
class ApprovalError extends Error {
    constructor(code) { super(`Readiness approval rejected: ${code}; details suppressed`); this.name = 'ApprovalError'; this.code = code }
}
const fail = code => { throw new ApprovalError(code) }
const exact = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.prototype.hasOwnProperty.call(value, key))
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value)
const identifier = value => matches(/^[a-zA-Z0-9_-]{1,64}(?![\s\S])/, value)
function timestamp(value) {
    if (!matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?![\s\S])/, value)) fail('APPROVAL_MALFORMED')
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail('APPROVAL_MALFORMED')
    return parsed
}
function validatePayload(payload) {
    if (!exact(payload, keys) || !matches(/^[a-f0-9]{64}(?![\s\S])/, payload.targetFingerprint)
        || !matches(/^[a-f0-9]{64}(?![\s\S])/, payload.nonce) || !identifier(payload.approverId) || !identifier(payload.keyId)
        || !(payload.initialAdminUsername === null || (typeof payload.initialAdminUsername === 'string' && payload.initialAdminUsername.length > 0 && payload.initialAdminUsername.length <= 256))) fail('APPROVAL_MALFORMED')
    if (payload.domain !== DOMAIN || payload.version !== VERSION || payload.environment !== 'production') fail('APPROVAL_PROTOCOL_MISMATCH')
    timestamp(payload.expires)
}
function canonicalApprovalBytes(payload) {
    validatePayload(payload)
    // Fixed ordered array, UTF-8 JSON, no separators/locale-dependent formatting.
    return Buffer.from(JSON.stringify(keys.map(key => payload[key])), 'utf8')
}
function validateLifetime(expires, now) {
    if (!Number.isFinite(now)) fail('APPROVAL_MALFORMED')
    const expiry = timestamp(expires)
    if (expiry <= now) fail('APPROVAL_EXPIRED')
    if (expiry > now + MAX_LIFETIME_MS) fail('APPROVAL_EXPIRY_TOO_FAR')
    return expiry
}
function createApprovalRequest({ targetFingerprint, expires, approverId, keyId, initialAdminUsername = null }, now) {
    // Requests contain no signature and confer no authority.
    const payload = { domain: DOMAIN, version: VERSION, environment: 'production', targetFingerprint,
        expires, nonce: randomBytes(32).toString('hex'), approverId, keyId, initialAdminUsername }
    validatePayload(payload)
    validateLifetime(expires, now)
    return payload
}
function verifyApproval(token, { targetFingerprint, initialAdminUsername = null, expires, trustedApprovers = [], now }) {
    if (token === undefined || token === '') fail('PRODUCTION_APPROVAL_REQUIRED')
    if (!matches(/^[A-Za-z0-9_-]+(?![\s\S])/, token) || token.length > 8192) fail('APPROVAL_MALFORMED')
    let envelope
    try {
        const bytes = Buffer.from(token, 'base64url')
        if (bytes.toString('base64url') !== token) fail('APPROVAL_MALFORMED')
        envelope = JSON.parse(bytes.toString('utf8'))
    } catch { fail('APPROVAL_MALFORMED') }
    if (!exact(envelope, ['payload', 'signature'])) fail('APPROVAL_MALFORMED')
    const { payload, signature } = envelope
    const bytes = canonicalApprovalBytes(payload)
    if (payload.targetFingerprint !== targetFingerprint) fail('APPROVAL_TARGET_MISMATCH')
    if (payload.initialAdminUsername !== initialAdminUsername || (expires !== undefined && payload.expires !== expires)) fail('APPROVAL_REQUEST_MISMATCH')
    const expiry = validateLifetime(payload.expires, now)
    if (!Array.isArray(trustedApprovers)) fail('APPROVAL_KEY_UNAUTHORIZED')
    const records = trustedApprovers.filter(record => record && record.keyId === payload.keyId)
    if (records.length !== 1 || records[0].approverId !== payload.approverId) fail('APPROVAL_KEY_UNAUTHORIZED')
    const record = records[0]
    if (record.revoked === true) fail('APPROVAL_KEY_REVOKED')
    if (record.revoked !== false || !(record.publicKey instanceof KeyObject) || record.publicKey.type !== 'public'
        || record.publicKey.asymmetricKeyType !== 'ed25519') fail('APPROVAL_KEY_UNAUTHORIZED')
    const notBefore = timestamp(record.notBefore), notAfter = timestamp(record.notAfter)
    if (notBefore > now) fail('APPROVAL_KEY_NOT_ACTIVE')
    if (notAfter <= now || expiry > notAfter || notBefore >= notAfter) fail('APPROVAL_KEY_EXPIRED')
    if (!matches(/^[A-Za-z0-9_-]{86}(?![\s\S])/, signature)) fail('APPROVAL_SIGNATURE_INVALID')
    const sig = Buffer.from(signature, 'base64url')
    if (sig.length !== 64 || sig.toString('base64url') !== signature) fail('APPROVAL_SIGNATURE_INVALID')
    let valid = false
    try { valid = verify(null, bytes, record.publicKey, sig) } catch { fail('APPROVAL_SIGNATURE_INVALID') }
    if (!valid) fail('APPROVAL_SIGNATURE_INVALID')
    return { approverId: payload.approverId, keyId: payload.keyId, expires: payload.expires }
}
module.exports = { createApprovalRequest, canonicalApprovalBytes, verifyApproval, ApprovalError }
