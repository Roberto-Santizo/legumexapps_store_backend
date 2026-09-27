import { Op } from "sequelize"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { packagingService } from "../../packaging/services/packaging.service"
import { isSameOptionGroup, resolveOptionGroupSpelling } from "../../../shared/utils/optionGroup.util"
import {
    CreateProductVariantPalletMaterialInput,
    UpdateProductVariantPalletMaterialInput
} from "../schemas/productVariantPalletMaterial.schema"

async function listProductVariantPalletMaterials(): Promise<ProductVariantPalletMaterial[]> {
    return ProductVariantPalletMaterial.findAll({ where: { isActive: true } })
}

async function getProductVariantPalletMaterialById(id: number): Promise<ProductVariantPalletMaterial> {
    const productVariantPalletMaterial = await ProductVariantPalletMaterial.findOne({ where: { id, isActive: true } })
    if (!productVariantPalletMaterial) throw new NotFoundError("ProductVariantPalletMaterial", id)
    return productVariantPalletMaterial
}

// Grupos de opciones (2026-09-24) -- mismo criterio que productVariantUnitMaterial.service.ts, ver
// el comentario ahí (defaults, auto-democión y normalización del nombre, todo POR GRUPO).
async function findActiveGroupedRows(productVariantId: number, excludeId: number | null): Promise<ProductVariantPalletMaterial[]> {
    const rows = await ProductVariantPalletMaterial.findAll({
        where: { productVariantId, optionGroup: { [Op.ne]: null }, isActive: true }
    })
    return rows.filter(row => row.id !== excludeId)
}

async function resolveOptionGroupOnWrite(
    productVariantId: number,
    requestedGroup: string | null,
    excludeId: number | null
): Promise<string | null> {
    if (requestedGroup === null) return null
    const groupedRows = await findActiveGroupedRows(productVariantId, excludeId)
    return resolveOptionGroupSpelling(requestedGroup, groupedRows.map(row => row.optionGroup))
}

async function resolveIsDefaultOnWrite(
    productVariantId: number,
    optionGroup: string | null,
    requestedIsDefault: boolean,
    excludeId: number | null
): Promise<boolean> {
    if (optionGroup === null) return false

    const groupSiblings = (await findActiveGroupedRows(productVariantId, excludeId))
        .filter(row => isSameOptionGroup(row.optionGroup, optionGroup))

    if (groupSiblings.length === 0) return true

    if (requestedIsDefault) {
        const currentDefaults = groupSiblings.filter(sibling => sibling.isDefault)
        if (currentDefaults.length > 0) {
            await ProductVariantPalletMaterial.update(
                { isDefault: false },
                { where: { id: { [Op.in]: currentDefaults.map(sibling => sibling.id) } } }
            )
        }
    }
    return requestedIsDefault
}

async function countOtherGroupSiblings(productVariantPalletMaterial: ProductVariantPalletMaterial): Promise<number> {
    const groupedRows = await findActiveGroupedRows(productVariantPalletMaterial.productVariantId, productVariantPalletMaterial.id)
    return groupedRows.filter(row => isSameOptionGroup(row.optionGroup, productVariantPalletMaterial.optionGroup)).length
}

// Bloquea (no auto-promueve) eliminar/desactivar el default de un grupo -- mismo criterio que
// productVariantUnitMaterial.service.ts::assertDeletionNotBlockedByDefault.
async function assertDeletionNotBlockedByDefault(productVariantPalletMaterial: ProductVariantPalletMaterial): Promise<void> {
    if (productVariantPalletMaterial.optionGroup === null || !productVariantPalletMaterial.isDefault) return

    if ((await countOtherGroupSiblings(productVariantPalletMaterial)) > 0) {
        throw new AppError(409, "errors.pallet_material_default_deletion_blocked", { group: productVariantPalletMaterial.optionGroup })
    }
}

// Vía UPDATE del mismo bloqueo (incluye mover el default a otro grupo) -- ver
// productVariantUnitMaterial.service.ts::assertUpdateKeepsADefault.
async function assertUpdateKeepsADefault(
    productVariantPalletMaterial: ProductVariantPalletMaterial,
    willBeProductVariantId: number,
    willBeGroup: string | null,
    willBeDefault: boolean
): Promise<void> {
    const isCurrentDefault = productVariantPalletMaterial.optionGroup !== null && productVariantPalletMaterial.isDefault
    if (!isCurrentDefault) return

    const staysDefaultOfSameGroup =
        willBeDefault &&
        willBeProductVariantId === productVariantPalletMaterial.productVariantId &&
        isSameOptionGroup(willBeGroup, productVariantPalletMaterial.optionGroup)
    if (staysDefaultOfSameGroup) return

    if ((await countOtherGroupSiblings(productVariantPalletMaterial)) > 0) {
        throw new AppError(409, "errors.material_default_required", { group: productVariantPalletMaterial.optionGroup })
    }
}

async function createProductVariantPalletMaterial(
    input: CreateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    await packagingService.assertPackagingHasRole(input.packagingId, "pallet")
    const optionGroup = await resolveOptionGroupOnWrite(input.productVariantId, input.optionGroup, null)
    const isDefault = await resolveIsDefaultOnWrite(input.productVariantId, optionGroup, input.isDefault, null)
    return ProductVariantPalletMaterial.create({ ...input, optionGroup, isDefault })
}

async function updateProductVariantPalletMaterial(
    id: number,
    input: UpdateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    const productVariantPalletMaterial = await getProductVariantPalletMaterialById(id)
    if (input.packagingId) await packagingService.assertPackagingHasRole(input.packagingId, "pallet")

    const effectiveProductVariantId = input.productVariantId ?? productVariantPalletMaterial.productVariantId
    const effectiveRequestedIsDefault = input.isDefault ?? productVariantPalletMaterial.isDefault
    const optionGroup = await resolveOptionGroupOnWrite(effectiveProductVariantId, input.optionGroup, productVariantPalletMaterial.id)
    await assertUpdateKeepsADefault(productVariantPalletMaterial, effectiveProductVariantId, optionGroup, effectiveRequestedIsDefault)
    const isDefault = await resolveIsDefaultOnWrite(
        effectiveProductVariantId,
        optionGroup,
        effectiveRequestedIsDefault,
        productVariantPalletMaterial.id
    )
    return productVariantPalletMaterial.update({ ...input, optionGroup, isDefault })
}

async function deleteProductVariantPalletMaterial(id: number): Promise<void> {
    const productVariantPalletMaterial = await getProductVariantPalletMaterialById(id)
    await assertDeletionNotBlockedByDefault(productVariantPalletMaterial)
    await productVariantPalletMaterial.update({ isActive: false })
}

export const productVariantPalletMaterialService = {
    listProductVariantPalletMaterials,
    getProductVariantPalletMaterialById,
    createProductVariantPalletMaterial,
    updateProductVariantPalletMaterial,
    deleteProductVariantPalletMaterial,
}
