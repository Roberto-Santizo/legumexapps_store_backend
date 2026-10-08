import { Op } from "sequelize"
import PackagingGroup from "../models/PackagingGroup.model"
import ProductVariantPalletMaterial from "../../product/models/ProductVariantPalletMaterial.model"
import ProductVariantUnitMaterial from "../../product/models/ProductVariantUnitMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { normalizeOptionGroup, optionGroupKey } from "../../../shared/utils/optionGroup.util"

async function get(id: number): Promise<PackagingGroup> {
    const group = await PackagingGroup.findByPk(id)
    if (!group) throw new NotFoundError("PackagingGroup", id)
    return group
}

async function assertUnique(nameKey: string, excludeId?: number): Promise<void> {
    if (await PackagingGroup.findOne({ where: { nameKey, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) } })) {
        throw new AppError(409, "errors.packaging_group_duplicate")
    }
}

async function create(displayName: string): Promise<PackagingGroup> {
    const name = normalizeOptionGroup(displayName)!
    const nameKey = optionGroupKey(name)!
    await assertUnique(nameKey)
    return PackagingGroup.create({ displayName: name, nameKey })
}

async function update(id: number, displayName: string): Promise<PackagingGroup> {
    const name = normalizeOptionGroup(displayName)!
    const nameKey = optionGroupKey(name)!
    await assertUnique(nameKey, id)
    return PackagingGroup.sequelize!.transaction(async transaction => {
        const group = await PackagingGroup.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE })
        if (!group) throw new NotFoundError("PackagingGroup", id)
        await group.update({ displayName: name, nameKey }, { transaction })
        // Keep the display label on live rows in sync. Frozen quote/draft JSON is never edited.
        await ProductVariantUnitMaterial.update({ optionGroup: name }, { where: { optionGroupId: id }, transaction })
        await ProductVariantPalletMaterial.update({ optionGroup: name }, { where: { optionGroupId: id }, transaction })
        return group
    })
}

async function status(id: number, isActive: boolean): Promise<PackagingGroup> {
    return (await get(id)).update({ isActive })
}

// Deactivation prevents new assignments, but does not change existing costed alternatives.
export async function resolveUnitMaterialGroup(
    optionGroupId: number | null | undefined,
    legacyName: string | null | undefined,
    currentGroupId?: number | null,
): Promise<{ optionGroupId: number | null; optionGroup: string | null }> {
    if (optionGroupId == null && !legacyName) return { optionGroupId: null, optionGroup: null }
    const group = optionGroupId != null
        ? await PackagingGroup.findByPk(optionGroupId)
        : await PackagingGroup.findOne({ where: { nameKey: optionGroupKey(legacyName) } })
    if (!group || (!group.isActive && group.id !== currentGroupId)) throw new AppError(422, "errors.packaging_group_unavailable")
    return { optionGroupId: group.id, optionGroup: group.displayName }
}

export const packagingGroupService = {
    list: () => PackagingGroup.findAll({ order: [["isActive", "DESC"], ["displayName", "ASC"], ["id", "ASC"]] }),
    get, create, update, status,
}
