/** Pure inspection of migration metadata. Does not establish schema compatibility. */
export interface MigrationRecord {
    readonly version: string
    readonly checksum: string
}

export type MigrationHistoryStatus = "up_to_date" | "behind" | "ahead" | "inconsistent"
export type MigrationHistoryIssueCode =
    | "invalid_input" | "empty_manifest" | "invalid_record" | "invalid_version"
    | "invalid_checksum" | "duplicate_version" | "out_of_order"
    | "checksum_mismatch" | "history_gap" | "unexpected_version"

export interface MigrationHistoryIssue {
    readonly code: MigrationHistoryIssueCode
    readonly source: "manifest" | "history"
    readonly index?: number
}

export interface MigrationHistoryResult {
    readonly status: MigrationHistoryStatus
    readonly schemaCompatibility: "unknown"
    readonly missingVersions: readonly string[]
    readonly additionalVersions: readonly string[]
    readonly issues: readonly MigrationHistoryIssue[]
}

// Absolute end assertion also rejects trailing newlines (unlike JavaScript's $).
const VERSION = /^(\d{12})_[a-z_]+\.sql(?![\s\S])/
const CHECKSUM = /^[a-f0-9]{64}(?![\s\S])/

function inspect(value: unknown, source: "manifest" | "history", issues: MigrationHistoryIssue[]): MigrationRecord[] {
    if (!Array.isArray(value)) {
        issues.push({ code: "invalid_input", source })
        return []
    }
    const records: MigrationRecord[] = []
    const identifiers = new Set<string>()
    let previous: string | undefined
    // Index iteration intentionally validates sparse array slots too.
    for (let index = 0; index < value.length; index++) {
        const row: unknown = value[index]
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
            issues.push({ code: "invalid_record", source, index })
            continue
        }
        const record = row as Record<string, unknown>
        const version = Object.prototype.hasOwnProperty.call(record, "version") ? record.version : undefined
        const checksum = Object.prototype.hasOwnProperty.call(record, "checksum") ? record.checksum : undefined
        const match = typeof version === "string" ? VERSION.exec(version) : null
        if (!match) issues.push({ code: "invalid_version", source, index })
        if (typeof checksum !== "string" || !CHECKSUM.test(checksum)) {
            issues.push({ code: "invalid_checksum", source, index })
        }
        if (match) {
            const identifier = match[1]
            if (identifiers.has(identifier)) issues.push({ code: "duplicate_version", source, index })
            else if (previous !== undefined && identifier < previous) issues.push({ code: "out_of_order", source, index })
            identifiers.add(identifier)
            previous = identifier
        }
        if (match && typeof checksum === "string" && CHECKSUM.test(checksum)) {
            records.push({ version: version as string, checksum })
        }
    }
    return records
}

/**
 * Inputs must already be ordered by version (not applied_at). They are never sorted
 * or mutated here. Accepts unknown to validate JSON/query results at runtime.
 * Diagnostics contain only fixed codes and positions, never raw input values.
 */
export function verifyMigrationHistory(manifest: unknown, history: unknown): MigrationHistoryResult {
    const issues: MigrationHistoryIssue[] = []
    const known = inspect(manifest, "manifest", issues)
    const applied = inspect(history, "history", issues)
    if (Array.isArray(manifest) && manifest.length === 0) issues.push({ code: "empty_manifest", source: "manifest" })
    const result = (status: MigrationHistoryStatus, missingVersions: string[] = [], additionalVersions: string[] = []): MigrationHistoryResult => ({
        status, schemaCompatibility: "unknown", missingVersions, additionalVersions, issues,
    })
    // No partial interpretation of malformed or unordered metadata.
    if (issues.length) return result("inconsistent")

    const knownByVersion = new Map(known.map(row => [row.version, row]))
    const appliedByVersion = new Map(applied.map(row => [row.version, row]))
    const missing = known.filter(row => !appliedByVersion.has(row.version)).map(row => row.version)
    const additional = applied.filter(row => !knownByVersion.has(row.version)).map(row => row.version)
    const lastKnownIdentifier = known[known.length - 1].version.slice(0, 12)
    applied.forEach((row, index) => {
        const expected = knownByVersion.get(row.version)
        if (expected && expected.checksum !== row.checksum) issues.push({ code: "checksum_mismatch", source: "history", index })
        if (!expected && row.version.slice(0, 12) <= lastKnownIdentifier) issues.push({ code: "unexpected_version", source: "history", index })
    })
    let gap = false
    known.forEach(row => {
        if (!appliedByVersion.has(row.version)) gap = true
        else if (gap) issues.push({ code: "history_gap", source: "history", index: applied.findIndex(item => item.version === row.version) })
    })
    // Later entries cannot excuse a missing known migration during rollback.
    if (missing.length && additional.length) issues.push({ code: "history_gap", source: "history" })
    if (issues.length) return result("inconsistent", missing, additional)
    if (additional.length) return result("ahead", missing, additional)
    return result(missing.length ? "behind" : "up_to_date", missing)
}
