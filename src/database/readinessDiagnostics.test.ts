import { ADMIN_ROLE_NAME, PERMISSIONS } from "./accessControlPolicy"
import { AccessSnapshot, PackagingSnapshot, diagnoseAccessControl, diagnosePackagingGroups } from "./readinessDiagnostics"

function access(): AccessSnapshot {
    return {
        permissions: PERMISSIONS.map((row, index) => ({ id: index + 1, name: row.name })),
        roles: [{ id: 1, name: ADMIN_ROLE_NAME }],
        rolePermissions: PERMISSIONS.map((_row, index) => ({ role_id: 1, permission_id: index + 1 })),
        users: [{ id: 1, username: "initial-admin", role_id: 1 }], initialAdminUsername: "initial-admin",
    }
}
function packaging(): PackagingSnapshot {
    return { groups: [{ id: 1, displayName: "Caja grande", nameKey: "caja grande", isActive: true }], associations: [
        { id: 1, level: "unit", productVariantId: 1, packagingId: 1, optionGroup: " CAJA   grande ", optionGroupId: 1, isActive: true, isDefault: true },
    ] }
}

test("shared catalog preserves 82 distinct permissions and administrator role", () => {
    expect(PERMISSIONS).toHaveLength(82)
    expect(new Set(PERMISSIONS.map(row => row.name)).size).toBe(82)
    expect(ADMIN_ROLE_NAME).toBe("Administrador")
    expect(PERMISSIONS).toContainEqual({ name: "siteContent:edit" })
})
test("prepared access does not assert authentication", () => {
    expect(diagnoseAccessControl(access())).toMatchObject({ status: "prepared", missingPermissions: [], missingExpectedAssignments: [],
        additionalAssignments: [], initialAdmin: "present_admin_role", authenticationVerified: false, issues: [] })
})
test("empty access reports all missing permissions, role and user", () => {
    const result = diagnoseAccessControl({ permissions: [], roles: [], rolePermissions: [], users: [], initialAdminUsername: "initial-admin" })
    expect(result.status).toBe("incomplete")
    expect(result.missingPermissions).toHaveLength(82)
    expect(result.missingExpectedAssignments).toHaveLength(82)
    expect(result.adminRoleCount).toBe(0)
    expect(result.initialAdmin).toBe("missing")
})
test("separates existing permission from absent admin assignment", () => {
    const data = access()
    const result = diagnoseAccessControl({ ...data, rolePermissions: data.rolePermissions.slice(1) })
    expect(result.missingPermissions).toEqual([])
    expect(result.missingExpectedAssignments).toEqual([PERMISSIONS[0].name])
    expect(result.status).toBe("incomplete")
})
test("accounts for ALL database permissions as the seeder does", () => {
    const data = access()
    const extended = { ...data, permissions: [...data.permissions, { id: 100, name: "legacy:custom" }] }
    expect(diagnoseAccessControl(extended)).toMatchObject({ status: "incomplete", unassignedDatabasePermissions: ["legacy:custom"] })
    expect(diagnoseAccessControl({ ...extended, rolePermissions: [...data.rolePermissions, { role_id: 1, permission_id: 100 }] }))
        .toMatchObject({ status: "prepared", additionalAssignments: ["legacy:custom"], unassignedDatabasePermissions: [] })
})
test.each([undefined, ""])("does not invent an initial admin identity for %j", initialAdminUsername => {
    expect(diagnoseAccessControl({ ...access(), initialAdminUsername })).toMatchObject({ initialAdmin: "not_specified", authenticationVerified: false })
})
test("reports initial admin in another role without proposing reassignment", () => {
    const data = access()
    expect(diagnoseAccessControl({ ...data, roles: [...data.roles, { id: 2, name: "Other" }], users: [{ id: 1, username: "initial-admin", role_id: 2 }] }))
        .toMatchObject({ status: "incomplete", initialAdmin: "present_other_role" })
})
test.each([
    ["permissions", "duplicate_permission"], ["roles", "duplicate_role"], ["users", "duplicate_user"], ["rolePermissions", "duplicate_role_permission"],
] as const)("detects duplicates in %s", (field, code) => {
    const data = access()
    const result = diagnoseAccessControl({ ...data, [field]: [...data[field], data[field][0]] })
    expect(result.status).toBe("inconsistent")
    expect(result.issues).toContain(code)
})
test("reports dangling links and user roles", () => {
    expect(diagnoseAccessControl({ ...access(), rolePermissions: [{ role_id: 999, permission_id: 999 }], users: [{ id: 1, username: "initial-admin", role_id: 999 }] }))
        .toMatchObject({ status: "inconsistent", issues: ["dangling_role_permission", "dangling_user_role"] })
})
test("administrator assignment to a nonexistent permission remains inconsistent", () => {
    const data = access()
    const result = diagnoseAccessControl({ ...data, rolePermissions: [...data.rolePermissions, { role_id: 1, permission_id: 999 }] })
    expect(result.status).toBe("inconsistent")
    expect(result.issues).toEqual(["dangling_role_permission"])
    expect(result.assignedPermissions).toHaveLength(82)
})
test("never accesses passwords or includes usernames in reports", () => {
    const data = access()
    const user = { ...data.users[0], get password(): never { throw new Error("Password accessed") } }
    const output = JSON.stringify(diagnoseAccessControl({ ...data, users: [user] }))
    expect(output).not.toContain("initial-admin")
    expect(output).not.toContain("password")
})
test("prepared groups use shared normalization without changing rows", () => {
    const data = packaging()
    const before = JSON.stringify(data)
    expect(diagnosePackagingGroups(data)).toMatchObject({ status: "prepared", pendingLegacy: [], findings: [], calculationVerified: false })
    expect(JSON.stringify(data)).toBe(before)
})
test.each(["unit", "pallet"] as const)("includes inactive legacy %s rows", level => {
    const data = packaging()
    expect(diagnosePackagingGroups({ ...data, associations: [{ ...data.associations[0], level, optionGroupId: null, isActive: false }] }))
        .toMatchObject({ status: "incomplete", pendingLegacy: [{ level, associationId: 1 }], findings: [{ code: "missing_group_id", level, associationId: 1 }] })
})
test.each(["", "   "])("identifies legacy labels the seeder would reject: %j", optionGroup => {
    const data = packaging()
    const result = diagnosePackagingGroups({ ...data, associations: [{ ...data.associations[0], optionGroup, optionGroupId: null }] })
    expect(result.status).toBe("inconsistent")
    expect(result.findings.map(row => row.code)).toEqual(["missing_group_id", "invalid_legacy_group"])
})
test("null group and null ID is a legitimate fixed association", () => {
    const data = packaging()
    expect(diagnosePackagingGroups({ ...data, associations: [{ ...data.associations[0], optionGroup: null, optionGroupId: null }] }))
        .toMatchObject({ status: "prepared", fixedRows: 1, pendingLegacy: [] })
})
test("intermediate text groups do not require an ID column", () => {
    const data = packaging()
    expect(diagnosePackagingGroups({ ...data, associations: [{ ...data.associations[0], level: "intermediate", optionGroupId: undefined }] }))
        .toMatchObject({ status: "prepared", intermediateTextGroups: 1, pendingLegacy: [] })
})
test("fixed intermediate association has no text group or conversion pending", () => {
    const data = packaging()
    expect(diagnosePackagingGroups({ ...data, associations: [{ ...data.associations[0], level: "intermediate", optionGroup: null, optionGroupId: undefined }] }))
        .toMatchObject({ status: "prepared", intermediateTextGroups: 0, pendingLegacy: [], findings: [] })
})
test.each([
    [{ optionGroupId: 999 }, "dangling_group_reference"],
    [{ optionGroup: "Other" }, "group_label_mismatch"],
    [{ optionGroup: null }, "group_label_mismatch"],
    [{ level: "intermediate" as const }, "unexpected_intermediate_group_id"],
])("detects association inconsistency %#", (change, code) => {
    const data = packaging()
    expect(diagnosePackagingGroups({ ...data, associations: [{ ...data.associations[0], ...change }] }).findings)
        .toContainEqual(expect.objectContaining({ code }))
})
test("detects invalid catalog keys and normalized duplicates", () => {
    const data = packaging()
    const result = diagnosePackagingGroups({ ...data, groups: [...data.groups, { ...data.groups[0], id: 2, displayName: " CAJA GRANDE ", nameKey: "WRONG" }] })
    expect(result.findings.map(row => row.code)).toEqual(["invalid_group_key", "duplicate_normalized_group"])
})
test("existing active associations to inactive groups are informational and remain prepared", () => {
    const data = packaging()
    expect(diagnosePackagingGroups({ ...data, groups: [{ ...data.groups[0], isActive: false }] }))
        .toMatchObject({ status: "prepared", findings: [{ code: "active_association_inactive_group", severity: "info", level: "unit", associationId: 1 }] })
})
test("informational inactive-group finding does not hide a real inconsistency", () => {
    const data = packaging()
    const result = diagnosePackagingGroups({ ...data, groups: [{ ...data.groups[0], isActive: false }],
        associations: [{ ...data.associations[0], optionGroup: "Other" }] })
    expect(result.status).toBe("inconsistent")
    expect(result.findings.map(row => row.code)).toEqual(["group_label_mismatch", "active_association_inactive_group"])
})
test("informational inactive-group finding does not hide pending conversion", () => {
    const data = packaging()
    const result = diagnosePackagingGroups({ ...data, groups: [{ ...data.groups[0], isActive: false }], associations: [
        data.associations[0], { ...data.associations[0], id: 2, packagingId: 2, optionGroupId: null, isDefault: false },
    ] })
    expect(result.status).toBe("incomplete")
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "active_association_inactive_group", severity: "info" }))
    expect(result.pendingLegacy).toEqual([{ level: "unit", associationId: 2 }])
})
test("a nonexistent group remains inconsistent", () => {
    const data = packaging()
    expect(diagnosePackagingGroups({ ...data, groups: [] })).toMatchObject({
        status: "inconsistent", findings: [{ code: "dangling_group_reference", level: "unit", associationId: 1 }],
    })
})
test("detects duplicated materials and active defaults, not normal alternatives", () => {
    const data = packaging()
    const alternative = { ...data.associations[0], id: 2, packagingId: 2, isDefault: false }
    expect(diagnosePackagingGroups({ ...data, associations: [...data.associations, alternative] }).status).toBe("prepared")
    expect(diagnosePackagingGroups({ ...data, associations: [...data.associations, { ...alternative, isDefault: true }] }).findings)
        .toContainEqual(expect.objectContaining({ code: "multiple_active_defaults" }))
    expect(diagnosePackagingGroups({ ...data, associations: [...data.associations, { ...alternative, packagingId: 1, isActive: false }] }).findings)
        .toContainEqual(expect.objectContaining({ code: "duplicate_variant_packaging" }))
})
test("association IDs and materials are scoped to each level", () => {
    const data = packaging()
    expect(diagnosePackagingGroups({ ...data, associations: [...data.associations, { ...data.associations[0], level: "pallet" }] }).status).toBe("prepared")
})
test("empty packaging snapshot is valid but does not verify catalogs or costs", () => {
    expect(diagnosePackagingGroups({ groups: [], associations: [] })).toMatchObject({ status: "prepared", calculationVerified: false })
})
test.each([null, {}, { permissions: [] }])("rejects malformed access safely %#", input => {
    expect(() => diagnoseAccessControl(input as unknown as AccessSnapshot)).toThrow("Invalid diagnostic snapshot; values suppressed")
})
test.each([null, {}, { groups: [], associations: [{ password: "secret" }] }])("rejects malformed packaging safely %#", input => {
    expect(() => diagnosePackagingGroups(input as unknown as PackagingSnapshot)).toThrow("Invalid diagnostic snapshot; values suppressed")
})
test("both analyses accept frozen snapshots and have no database adapter", () => {
    const a = access(), p = packaging()
    for (const rows of [a.permissions, a.roles, a.rolePermissions, a.users, p.groups, p.associations]) {
        rows.forEach(Object.freeze)
        Object.freeze(rows)
    }
    expect(diagnoseAccessControl(Object.freeze(a)).status).toBe("prepared")
    expect(diagnosePackagingGroups(Object.freeze(p)).status).toBe("prepared")
})

test("rejects sparse snapshots rather than declaring them prepared", () => {
    expect(() => diagnoseAccessControl({ ...access(), permissions: new Array(1) })).toThrow(TypeError)
    expect(() => diagnosePackagingGroups({ groups: new Array(1), associations: [] })).toThrow(TypeError)
})

test("does not mistake a missing column projection for a null group ID", () => {
    const data = packaging()
    expect(() => diagnosePackagingGroups({ ...data, associations: [{ ...data.associations[0], optionGroupId: undefined }] })).toThrow(TypeError)
})

test("reports duplicate group and association IDs", () => {
    const data = packaging()
    const result = diagnosePackagingGroups({ groups: [...data.groups, data.groups[0]], associations: [...data.associations, data.associations[0]] })
    expect(result.findings.map(row => row.code)).toEqual(expect.arrayContaining(["duplicate_group_id", "duplicate_association_id"]))
})

test("empty normalized catalog names are invalid", () => {
    expect(diagnosePackagingGroups({ groups: [{ id: 1, displayName: " ", nameKey: "", isActive: false }], associations: [] }).findings)
        .toEqual([{ code: "invalid_group_key", groupId: 1 }])
})

test("duplicate usernames make initial administrator presence ambiguous", () => {
    const data = access()
    expect(diagnoseAccessControl({ ...data, users: [...data.users, { ...data.users[0], id: 2 }] }))
        .toMatchObject({ status: "inconsistent", initialAdmin: "ambiguous" })
})

test("a user without a role does not count as prepared administrator", () => {
    const data = access()
    expect(diagnoseAccessControl({ ...data, users: [{ ...data.users[0], role_id: null }] }))
        .toMatchObject({ status: "incomplete", initialAdmin: "present_other_role" })
})
