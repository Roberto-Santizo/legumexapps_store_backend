import { optionGroupKey } from "./optionGroup.util"
export function materialGroupIdentity(row: { optionGroup: string | null; optionGroupId?: number | null }): string | null {
    return row.optionGroupId != null ? `id:${row.optionGroupId}` : optionGroupKey(row.optionGroup)
}
