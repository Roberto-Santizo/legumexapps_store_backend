import { Op } from "sequelize"
import PackagingGroup from "../../features/packagingGroup/models/PackagingGroup.model"
import ProductVariantPalletMaterial from "../../features/product/models/ProductVariantPalletMaterial.model"
import ProductVariantUnitMaterial from "../../features/product/models/ProductVariantUnitMaterial.model"
import { normalizeOptionGroup, optionGroupKey } from "../../shared/utils/optionGroup.util"

// Additive, idempotent conversion after sync. No sample groups, row deletions or snapshot edits.
export async function seedPackagingGroups(): Promise<void> {
    await PackagingGroup.sequelize!.transaction(async transaction => {
        const options = {
            where: { optionGroupId: null, optionGroup: { [Op.ne]: null } },
            order: [["id", "ASC"]] as [string, string][], transaction, lock: transaction.LOCK.UPDATE,
        }
        const rows = [
            ...await ProductVariantUnitMaterial.findAll(options),
            ...await ProductVariantPalletMaterial.findAll(options),
        ]
        for (const row of rows) {
            const displayName = normalizeOptionGroup(row.optionGroup)
            if (!displayName) throw new Error(`Invalid legacy option group on material association ${row.id}`)
            const [group] = await PackagingGroup.findOrCreate({
                where: { nameKey: optionGroupKey(displayName)! }, defaults: { displayName, nameKey: optionGroupKey(displayName)! }, transaction,
            })
            await row.update({ optionGroupId: group.id, optionGroup: group.displayName }, { transaction })
        }
    })
}
