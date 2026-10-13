import { MigrationRecord, verifyMigrationHistory } from "./migrationHistory"

const a: MigrationRecord = { version: "202610120001_first.sql", checksum: "a".repeat(64) }
const b: MigrationRecord = { version: "202610120010_second.sql", checksum: "b".repeat(64) }
const c: MigrationRecord = { version: "202610130001_later.sql", checksum: "c".repeat(64) }
const manifest = [a, b]

test.each([
    ["matching history", manifest, "up_to_date", []],
    ["empty history", [], "behind", [a.version, b.version]],
    ["valid prefix", [a], "behind", [b.version]],
    ["rollback with later history", [a, b, c], "ahead", []],
] as const)("classifies %s", (_label, history, status, missing) => {
    expect(verifyMigrationHistory(manifest, history)).toEqual({
        status, schemaCompatibility: "unknown", missingVersions: missing,
        additionalVersions: status === "ahead" ? [c.version] : [], issues: [],
    })
})

test.each([
    ["missing initial migration", [b], "history_gap"],
    ["gap before future migration", [a, c], "history_gap"],
    ["only future migration", [c], "history_gap"],
    ["checksum change", [a, { ...b, checksum: "d".repeat(64) }], "checksum_mismatch"],
    ["changed checksum during rollback", [{ ...a, checksum: "d".repeat(64) }, b, c], "checksum_mismatch"],
    ["duplicate", [a, a], "duplicate_version"],
    ["numeric identifier reused under another name", [a, { ...a, version: "202610120001_other.sql" }], "duplicate_version"],
    ["reversed history", [b, a], "out_of_order"],
    ["reversed future suffix", [a, b, { ...c, version: "202610140001_last.sql" }, c], "out_of_order"],
    ["unknown earlier migration", [{ ...a, version: "202610110001_unknown.sql" }, a, b], "unexpected_version"],
    ["renamed known migration", [a, { ...b, version: "202610120010_renamed.sql" }], "unexpected_version"],
] as const)("rejects %s", (_label, history, code) => {
    const result = verifyMigrationHistory(manifest, history)
    expect(result.status).toBe("inconsistent")
    expect(result.schemaCompatibility).toBe("unknown")
    expect(result.issues).toContainEqual(expect.objectContaining({ code, source: "history" }))
})

test.each([
    ["empty", [], "empty_manifest"],
    ["reversed", [b, a], "out_of_order"],
    ["duplicate", [a, a], "duplicate_version"],
    ["reused identifier", [a, { ...a, version: "202610120001_alias.sql" }], "duplicate_version"],
] as const)("rejects %s manifest", (_label, input, code) => {
    expect(verifyMigrationHistory(input, manifest)).toMatchObject({
        status: "inconsistent", issues: expect.arrayContaining([expect.objectContaining({ code, source: "manifest" })]),
    })
})

describe.each(["manifest", "history"] as const)("malformed %s", source => {
    test.each([undefined, null, {}, "secret://value", 1, true])("rejects non-array %j", input => {
        const result = source === "manifest" ? verifyMigrationHistory(input, []) : verifyMigrationHistory(manifest, input)
        expect(result.status).toBe("inconsistent")
        expect(result.issues).toContainEqual({ code: "invalid_input", source })
        expect(JSON.stringify(result)).not.toContain("secret://value")
    })
    test.each([
        null, undefined, [], "secret://value", 1, {},
        { ...a, version: 1 }, { ...a, version: "202610120001_first.sql\n" },
        { ...a, version: " 202610120001_first.sql" }, { ...a, version: "202610120001_FIRST.sql" },
        { ...a, version: "../202610120001_first.sql" },
        { ...a, checksum: null }, { ...a, checksum: "a".repeat(63) },
        { ...a, checksum: "A".repeat(64) }, { ...a, checksum: "g".repeat(64) },
        { ...a, checksum: "a".repeat(64) + "\n" },
        Object.create(a) as unknown,
    ])("rejects malformed record %#", row => {
        const result = source === "manifest" ? verifyMigrationHistory([row], []) : verifyMigrationHistory(manifest, [row])
        expect(result.status).toBe("inconsistent")
        expect(result.issues.length).toBeGreaterThan(0)
        expect(result.missingVersions).toEqual([])
        expect(result.additionalVersions).toEqual([])
        expect(JSON.stringify(result)).not.toContain("secret://value")
    })
    test("rejects sparse arrays", () => {
        const sparse = new Array(1)
        const result = source === "manifest" ? verifyMigrationHistory(sparse, []) : verifyMigrationHistory(manifest, sparse)
        expect(result.issues).toContainEqual({ code: "invalid_record", source, index: 0 })
    })
})

test("reports missing versions and future suffix without accepting gaps", () => {
    expect(verifyMigrationHistory(manifest, [a, c])).toMatchObject({
        status: "inconsistent", missingVersions: [b.version], additionalVersions: [c.version],
    })
})

test("detects an internal gap in a longer known manifest", () => {
    expect(verifyMigrationHistory([a, b, c], [a, c])).toMatchObject({
        status: "inconsistent", missingVersions: [b.version], additionalVersions: [],
        issues: [{ code: "history_gap", source: "history", index: 1 }],
    })
})

test("accepts multiple future versions without claiming their checksums are verified", () => {
    const later = { version: "202610150001_future.sql", checksum: "e".repeat(64) }
    expect(verifyMigrationHistory(manifest, [a, b, c, later])).toMatchObject({
        status: "ahead", schemaCompatibility: "unknown", additionalVersions: [c.version, later.version], issues: [],
    })
})

test("does not mutate frozen inputs; ignores database metadata fields", () => {
    const known = Object.freeze([Object.freeze({ ...a }), Object.freeze({ ...b })])
    const history = Object.freeze([Object.freeze({ ...a, applied_at: "not an ordering key" }), Object.freeze({ ...b })])
    const before = JSON.stringify({ known, history })
    expect(verifyMigrationHistory(known, history).status).toBe("up_to_date")
    expect(JSON.stringify({ known, history })).toBe(before)
})

test("does not share output lists between invocations", () => {
    const first = verifyMigrationHistory(manifest, [])
    const mutableList = first.missingVersions as string[]
    mutableList.push("caller mutation")
    expect(verifyMigrationHistory(manifest, []).missingVersions).toEqual([a.version, b.version])
})
