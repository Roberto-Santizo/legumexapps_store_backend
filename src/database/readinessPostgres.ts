import type { AccessSnapshot, PackagingSnapshot, PackagingAssociationSnapshot } from "./readinessDiagnostics"

/** A dedicated, already-connected pg.Client, not a Pool or a client in a transaction. */
export interface ReadinessQueryClient {
    query(sql: string): Promise<unknown>
}
export interface ReadinessReadOptions {
    readonly initialAdminUsername: string | undefined
}
export interface ReadinessSnapshots {
    readonly access: AccessSnapshot
    readonly packaging: PackagingSnapshot
}
export type ReadinessReadErrorCode = "INVALID_INPUT" | "CLIENT_BUSY" | "INVALID_RESPONSE"
    | "MISSING_TABLE" | "MISSING_COLUMN" | "QUERY_FAILED" | "ROLLBACK_FAILED" | "TRANSACTION_NOT_ISOLATED"

export class ReadinessReadError extends Error {
    constructor(readonly code: ReadinessReadErrorCode, readonly rollbackFailed = false) {
        super(`Readiness snapshot failed: ${code}${rollbackFailed ? "; rollback failed" : ""}; sensitive details suppressed`)
        this.name = "ReadinessReadError"
    }
}

type Check = (value: unknown) => boolean
type Row = Record<string, unknown>
const id: Check = value => typeof value === "number" && Number.isSafeInteger(value) && value > 0
const label: Check = value => typeof value === "string" && value.length > 0
const string: Check = value => typeof value === "string"
const boolean: Check = value => typeof value === "boolean"
const nullableId: Check = value => value === null || id(value)
const nullableString: Check = value => value === null || string(value)
const ordinary = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value)
const owns = (row: Row, key: string) => Object.prototype.hasOwnProperty.call(row, key)
const activeClients = new WeakSet<object>()

const named = { id, name: label }
const association = { id, productVariantId: id, packagingId: id, optionGroup: nullableString, isActive: boolean, isDefault: boolean }
const transactionSettingsSql = "SELECT current_setting('transaction_isolation') AS transaction_isolation, current_setting('transaction_read_only') AS transaction_read_only"

// Static SQL, fully qualified to avoid dependence on a supplied search_path.
// role_permissions is the physical table declared by RolePermission, not rolePermissions.
const reads = [
    { sql: 'SELECT id, name FROM public.permissions ORDER BY id', columns: named },
    { sql: 'SELECT id, name FROM public.roles ORDER BY id', columns: named },
    { sql: 'SELECT role_id, permission_id FROM public.role_permissions ORDER BY role_id, permission_id', columns: { role_id: id, permission_id: id } },
    { sql: 'SELECT id, username, role_id FROM public.users ORDER BY id', columns: { id, username: label, role_id: nullableId } },
    { sql: 'SELECT id, "displayName", "nameKey", "isActive" FROM public."packagingGroups" ORDER BY id', columns: { id, displayName: string, nameKey: string, isActive: boolean } },
    { sql: 'SELECT id, "productVariantId", "packagingId", "optionGroup", "isActive", "isDefault", "optionGroupId" FROM public."productVariantUnitMaterials" ORDER BY id', columns: { ...association, optionGroupId: nullableId } },
    { sql: 'SELECT id, "productVariantId", "packagingId", "optionGroup", "isActive", "isDefault", "optionGroupId" FROM public."productVariantPalletMaterials" ORDER BY id', columns: { ...association, optionGroupId: nullableId } },
    { sql: 'SELECT id, "productVariantId", "packagingId", "optionGroup", "isActive", "isDefault" FROM public."productVariantIntermediateMaterials" ORDER BY id', columns: association },
] as const

function validateRows(result: unknown, columns: Record<string, Check>): Row[] {
    const invalid = () => { throw new ReadinessReadError("INVALID_RESPONSE") }
    if (!ordinary(result) || result.command !== "SELECT" || !Array.isArray(result.rows) || !Array.isArray(result.fields)
        || result.rowCount !== result.rows.length) return invalid()
    const names = Object.keys(columns)
    const fields: unknown[] = Array.from(result.fields)
    if (fields.length !== names.length || fields.some((field, index) => !ordinary(field) || field.name !== names[index])) return invalid()
    // Reject sparse rows, missing columns, unexpected fields and incorrect primitive types.
    return Array.from(result.rows as unknown[]).map(row => {
        if (!ordinary(row) || Object.keys(row).length !== names.length) return invalid()
        const copy: Row = {}
        for (const name of names) {
            if (!owns(row, name) || !columns[name](row[name])) return invalid()
            copy[name] = row[name]
        }
        return copy
    })
}

function controlled(error: unknown): ReadinessReadError {
    if (error instanceof ReadinessReadError) return new ReadinessReadError(error.code, error.rollbackFailed)
    const code = ordinary(error) ? error.code : undefined
    return new ReadinessReadError(code === "42P01" ? "MISSING_TABLE" : code === "42703" ? "MISSING_COLUMN" : "QUERY_FAILED")
}

/** Does not connect/end/release the injected client or invoke diagnostics/seeders. */
export async function readReadinessSnapshots(client: ReadinessQueryClient, options: ReadinessReadOptions): Promise<ReadinessSnapshots> {
    if (!ordinary(client) || typeof client.query !== "function" || !ordinary(options) || !owns(options, "initialAdminUsername")
        || !(options.initialAdminUsername === undefined || (typeof options.initialAdminUsername === "string" && options.initialAdminUsername.length > 0))) {
        throw new ReadinessReadError("INVALID_INPUT")
    }
    const initialAdminUsername = options.initialAdminUsername
    if (activeClients.has(client)) throw new ReadinessReadError("CLIENT_BUSY")
    activeClients.add(client)
    let failure: ReadinessReadError | undefined
    let rollbackFailed = false
    let snapshots: ReadinessSnapshots | undefined
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        await client.query("SET LOCAL statement_timeout = '5000ms'")
        await client.query("SET LOCAL lock_timeout = '1000ms'")
        const settings = validateRows(await client.query(transactionSettingsSql), { transaction_isolation: string, transaction_read_only: string })
        if (settings.length !== 1) throw new ReadinessReadError("INVALID_RESPONSE")
        if (settings[0].transaction_isolation !== "repeatable read" || settings[0].transaction_read_only !== "on") {
            throw new ReadinessReadError("TRANSACTION_NOT_ISOLATED")
        }
        // Effective properties do not prove that BEGIN created a new transaction.
        const rows: Row[][] = []
        for (const read of reads) rows.push(validateRows(await client.query(read.sql), read.columns))
        const withLevel = (index: number, level: PackagingAssociationSnapshot["level"]) => rows[index].map(row => ({ ...row, level }))
        // Every field was checked above; copied plain objects contain only the projection.
        snapshots = {
            access: { permissions: rows[0], roles: rows[1], rolePermissions: rows[2], users: rows[3], initialAdminUsername },
            packaging: { groups: rows[4], associations: [...withLevel(5, "unit"), ...withLevel(6, "pallet"), ...withLevel(7, "intermediate")] },
        } as unknown as ReadinessSnapshots
    } catch (error) {
        failure = controlled(error)
    } finally {
        // Attempt even after BEGIN failure; never expose results before cleanup succeeds.
        try { await client.query("ROLLBACK") }
        catch { rollbackFailed = true }
        activeClients.delete(client)
    }
    if (failure) throw new ReadinessReadError(failure.code, rollbackFailed)
    if (rollbackFailed) throw new ReadinessReadError("ROLLBACK_FAILED", true)
    return snapshots!
}
