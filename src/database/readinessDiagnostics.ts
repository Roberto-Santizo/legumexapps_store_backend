import { ADMIN_ROLE_NAME, PERMISSIONS } from "./accessControlPolicy"
import { normalizeOptionGroup, optionGroupKey } from "../shared/utils/optionGroup.util"

// Snapshots must be complete, coherent and projected by a future read-only adapter.
// No configuration, models, driver, filesystem or database operations are imported.
export interface AccessSnapshot {
    readonly permissions: readonly { readonly id: number; readonly name: string }[]
    readonly roles: readonly { readonly id: number; readonly name: string }[]
    readonly rolePermissions: readonly { readonly role_id: number; readonly permission_id: number }[]
    readonly users: readonly { readonly id: number; readonly username: string; readonly role_id: number | null }[]
    readonly initialAdminUsername?: string
}

function requireSnapshot(condition: boolean): asserts condition {
    if (!condition) throw new TypeError("Invalid diagnostic snapshot; values suppressed")
}
const validId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0
const text = (value: unknown) => typeof value === "string" && value.length > 0
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

function validateAccess(snapshot: AccessSnapshot): void {
    requireSnapshot(object(snapshot))
    requireSnapshot(Array.isArray(snapshot.permissions) && Array.isArray(snapshot.roles) && Array.isArray(snapshot.rolePermissions) && Array.isArray(snapshot.users))
    for (const rows of [snapshot.permissions, snapshot.roles, snapshot.rolePermissions, snapshot.users]) requireSnapshot(Array.from(rows).every(object))
    requireSnapshot(snapshot.permissions.every(row => object(row) && validId(row.id) && text(row.name)))
    requireSnapshot(snapshot.roles.every(row => object(row) && validId(row.id) && text(row.name)))
    requireSnapshot(snapshot.rolePermissions.every(row => object(row) && validId(row.role_id) && validId(row.permission_id)))
    requireSnapshot(snapshot.users.every(row => object(row) && validId(row.id) && text(row.username) && (row.role_id === null || validId(row.role_id))))
    requireSnapshot(snapshot.initialAdminUsername === undefined || typeof snapshot.initialAdminUsername === "string")
}

export function diagnoseAccessControl(snapshot: AccessSnapshot) {
    validateAccess(snapshot)
    const expected = PERMISSIONS.map(permission => permission.name)
    const expectedSet = new Set(expected)
    const permissions = new Map(snapshot.permissions.map(permission => [permission.id, permission]))
    const roles = new Map(snapshot.roles.map(role => [role.id, role]))
    const adminRoles = snapshot.roles.filter(role => role.name === ADMIN_ROLE_NAME)
    const adminIds = new Set(adminRoles.map(role => role.id))
    const adminLinks = snapshot.rolePermissions.filter(link => adminIds.has(link.role_id))
    const assigned = [...new Set(adminLinks.flatMap(link => {
        const permission = permissions.get(link.permission_id)
        return permission ? [permission.name] : []
    }))].sort()
    const assignedSet = new Set(assigned)
    const existingNames = new Set(snapshot.permissions.map(permission => permission.name))
    const missingPermissions = expected.filter(name => !existingNames.has(name))
    const missingExpectedAssignments = expected.filter(name => !assignedSet.has(name))
    const additionalAssignments = assigned.filter(name => !expectedSet.has(name))
    // The current seeder grants ALL database permissions, not only the code catalog.
    const unassignedDatabasePermissions = [...existingNames].filter(name => !assignedSet.has(name)).sort()
    const issues: string[] = []
    const duplicate = <T>(rows: readonly T[], key: (row: T) => string | number) => new Set(rows.map(key)).size !== rows.length
    if (duplicate(snapshot.permissions, row => row.id) || duplicate(snapshot.permissions, row => row.name)) issues.push("duplicate_permission")
    if (duplicate(snapshot.roles, row => row.id) || duplicate(snapshot.roles, row => row.name)) issues.push("duplicate_role")
    if (duplicate(snapshot.users, row => row.id) || duplicate(snapshot.users, row => row.username)) issues.push("duplicate_user")
    if (duplicate(snapshot.rolePermissions, row => `${row.role_id}:${row.permission_id}`)) issues.push("duplicate_role_permission")
    if (snapshot.rolePermissions.some(link => !roles.has(link.role_id) || !permissions.has(link.permission_id))) issues.push("dangling_role_permission")
    if (snapshot.users.some(user => user.role_id !== null && !roles.has(user.role_id))) issues.push("dangling_user_role")
    const usernameConfigured = snapshot.initialAdminUsername !== undefined && snapshot.initialAdminUsername !== ""
    const initialUsers = usernameConfigured ? snapshot.users.filter(user => user.username === snapshot.initialAdminUsername) : []
    const initialAdmin = !usernameConfigured ? "not_specified" : initialUsers.length === 0 ? "missing"
        : initialUsers.length > 1 ? "ambiguous" : adminIds.has(initialUsers[0].role_id ?? -1) ? "present_admin_role" : "present_other_role"
    return {
        status: issues.length ? "inconsistent" : missingPermissions.length || adminRoles.length !== 1 || unassignedDatabasePermissions.length
            || initialAdmin === "missing" || initialAdmin === "present_other_role" ? "incomplete" : "prepared",
        adminRoleCount: adminRoles.length, assignedPermissions: assigned, missingPermissions,
        missingExpectedAssignments, additionalAssignments, unassignedDatabasePermissions,
        initialAdmin, issues,
        // Presence is not proof of login viability or of an approved privilege policy.
        authenticationVerified: false as const,
    }
}

export interface PackagingGroupSnapshot {
    readonly id: number
    readonly displayName: string
    readonly nameKey: string
    readonly isActive: boolean
}
export interface PackagingAssociationSnapshot {
    readonly id: number
    readonly level: "unit" | "intermediate" | "pallet"
    readonly productVariantId: number
    readonly packagingId: number
    readonly optionGroup: string | null
    // Intermediate associations have no such column in the current model.
    readonly optionGroupId?: number | null
    readonly isActive: boolean
    readonly isDefault: boolean
}
export interface PackagingSnapshot {
    readonly groups: readonly PackagingGroupSnapshot[]
    readonly associations: readonly PackagingAssociationSnapshot[]
}
export interface PackagingFinding {
    readonly code: string
    readonly severity?: "info"
    readonly level?: PackagingAssociationSnapshot["level"]
    readonly associationId?: number
    readonly groupId?: number
}

export function diagnosePackagingGroups(snapshot: PackagingSnapshot) {
    requireSnapshot(object(snapshot) && Array.isArray(snapshot.groups) && Array.isArray(snapshot.associations))
    requireSnapshot(Array.from(snapshot.groups).every(object) && Array.from(snapshot.associations).every(object))
    requireSnapshot(snapshot.groups.every(row => object(row) && validId(row.id) && typeof row.displayName === "string" && typeof row.nameKey === "string" && typeof row.isActive === "boolean"))
    requireSnapshot(snapshot.associations.every(row => object(row) && validId(row.id) && validId(row.productVariantId) && validId(row.packagingId)
        && typeof row.level === "string" && ["unit", "intermediate", "pallet"].includes(row.level) && (row.optionGroup === null || typeof row.optionGroup === "string")
        && (row.level === "intermediate" || row.optionGroupId !== undefined)
        && (row.optionGroupId == null || validId(row.optionGroupId)) && typeof row.isActive === "boolean" && typeof row.isDefault === "boolean"))
    const findings: PackagingFinding[] = []
    const groups = new Map<number, PackagingGroupSnapshot>()
    const groupKeys = new Set<string>()
    for (const group of snapshot.groups) {
        if (groups.has(group.id)) findings.push({ code: "duplicate_group_id", groupId: group.id })
        groups.set(group.id, group)
        const key = optionGroupKey(group.displayName)
        if (key === null || key !== group.nameKey) findings.push({ code: "invalid_group_key", groupId: group.id })
        if (key !== null && groupKeys.has(key)) findings.push({ code: "duplicate_normalized_group", groupId: group.id })
        if (key !== null) groupKeys.add(key)
    }
    const rowIds = new Set<string>()
    const materials = new Set<string>()
    const activeDefaults = new Set<string>()
    const pending: { level: "unit" | "pallet"; associationId: number }[] = []
    let fixedRows = 0
    let intermediateTextGroups = 0
    for (const row of snapshot.associations) {
        const report = (code: string, severity?: "info") => findings.push({ code, level: row.level, associationId: row.id, ...(severity ? { severity } : {}) })
        const rowKey = `${row.level}:${row.id}`
        if (rowIds.has(rowKey)) report("duplicate_association_id")
        rowIds.add(rowKey)
        const materialKey = `${row.level}:${row.productVariantId}:${row.packagingId}`
        if (materials.has(materialKey)) report("duplicate_variant_packaging")
        materials.add(materialKey)
        const textKey = optionGroupKey(row.optionGroup)
        if (row.level === "intermediate") {
            if (row.optionGroupId != null) report("unexpected_intermediate_group_id")
            if (textKey !== null) intermediateTextGroups++
        } else if (row.optionGroupId == null) {
            if (row.optionGroup !== null) {
                pending.push({ level: row.level, associationId: row.id })
                report("missing_group_id")
                if (normalizeOptionGroup(row.optionGroup) === null) report("invalid_legacy_group")
            } else fixedRows++
        } else {
            const group = groups.get(row.optionGroupId)
            if (!group) report("dangling_group_reference")
            else {
                if (textKey !== optionGroupKey(group.displayName)) report("group_label_mismatch")
                // Deactivation blocks new assignments, not existing associations/costs.
                if (row.isActive && !group.isActive) report("active_association_inactive_group", "info")
            }
        }
        // Alternatives sharing a group are normal. Multiple active defaults are only
        // a potential ambiguity, not proof of a wrong cost or permission to repair.
        const identity = row.level !== "intermediate" && row.optionGroupId != null ? `id:${row.optionGroupId}` : textKey === null ? null : `text:${textKey}`
        if (row.isActive && row.isDefault && identity !== null) {
            const key = `${row.level}:${row.productVariantId}:${identity}`
            if (activeDefaults.has(key)) report("multiple_active_defaults")
            activeDefaults.add(key)
        }
    }
    const inconsistent = findings.some(finding => finding.severity !== "info" && finding.code !== "missing_group_id")
    return {
        status: inconsistent ? "inconsistent" : pending.length ? "incomplete" : "prepared",
        pendingLegacy: pending, fixedRows, intermediateTextGroups, findings,
        calculationVerified: false as const,
    }
}
