export function parseDbSyncAlter(value: string | undefined): boolean {
    if (value === undefined || value === "false") return false
    if (value === "true") return true
    throw new Error("Invalid DB_SYNC_ALTER: expected exactly true, false, or an absent variable")
}
