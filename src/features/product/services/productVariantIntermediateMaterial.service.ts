import { Op } from "sequelize"
import ProductVariantIntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { packagingService } from "../../packaging/services/packaging.service"
import { isSameOptionGroup, resolveOptionGroupSpelling } from "../../../shared/utils/optionGroup.util"
import {
    CreateProductVariantIntermediateMaterialInput,
    UpdateProductVariantIntermediateMaterialInput
} from "../schemas/productVariantIntermediateMaterial.schema"

async function listProductVariantIntermediateMaterials(): Promise<ProductVariantIntermediateMaterial[]> {
    return ProductVariantIntermediateMaterial.findAll({ where: { isActive: true } })
}

async function getProductVariantIntermediateMaterialById(id: number): Promise<ProductVariantIntermediateMaterial> {
    const productVariantIntermediateMaterial = await ProductVariantIntermediateMaterial.findOne({ where: { id, isActive: true } })
    if (!productVariantIntermediateMaterial) throw new NotFoundError("ProductVariantIntermediateMaterial", id)
    return productVariantIntermediateMaterial
}

// Grupos de opciones -- mismo criterio que productVariantUnitMaterial.service.ts, ver
// el comentario ahí (defaults, auto-democión y normalización del nombre, todo POR GRUPO).
async function findActiveGroupedRows(productVariantId: number, excludeId: number | null): Promise<ProductVariantIntermediateMaterial[]> {
    const rows = await ProductVariantIntermediateMaterial.findAll({
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
            await ProductVariantIntermediateMaterial.update(
                { isDefault: false },
                { where: { id: { [Op.in]: currentDefaults.map(sibling => sibling.id) } } }
            )
        }
    }
    return requestedIsDefault
}

async function countOtherGroupSiblings(productVariantIntermediateMaterial: ProductVariantIntermediateMaterial): Promise<number> {
    const groupedRows = await findActiveGroupedRows(productVariantIntermediateMaterial.productVariantId, productVariantIntermediateMaterial.id)
    return groupedRows.filter(row => isSameOptionGroup(row.optionGroup, productVariantIntermediateMaterial.optionGroup)).length
}

// Bloquea (no auto-promueve) eliminar/desactivar el default de un grupo -- mismo criterio que
// productVariantUnitMaterial.service.ts::assertDeletionNotBlockedByDefault.
async function assertDeletionNotBlockedByDefault(productVariantIntermediateMaterial: ProductVariantIntermediateMaterial): Promise<void> {
    if (productVariantIntermediateMaterial.optionGroup === null || !productVariantIntermediateMaterial.isDefault) return

    if ((await countOtherGroupSiblings(productVariantIntermediateMaterial)) > 0) {
        throw new AppError(409, "errors.intermediate_material_default_deletion_blocked", { group: productVariantIntermediateMaterial.optionGroup })
    }
}

// Vía UPDATE del mismo bloqueo (incluye mover el default a otro grupo) -- ver
// productVariantUnitMaterial.service.ts::assertUpdateKeepsADefault.
async function assertUpdateKeepsADefault(
    productVariantIntermediateMaterial: ProductVariantIntermediateMaterial,
    willBeProductVariantId: number,
    willBeGroup: string | null,
    willBeDefault: boolean
): Promise<void> {
    const isCurrentDefault = productVariantIntermediateMaterial.optionGroup !== null && productVariantIntermediateMaterial.isDefault
    if (!isCurrentDefault) return

    const staysDefaultOfSameGroup =
        willBeDefault &&
        willBeProductVariantId === productVariantIntermediateMaterial.productVariantId &&
        isSameOptionGroup(willBeGroup, productVariantIntermediateMaterial.optionGroup)
    if (staysDefaultOfSameGroup) return

    if ((await countOtherGroupSiblings(productVariantIntermediateMaterial)) > 0) {
        throw new AppError(409, "errors.material_default_required", { group: productVariantIntermediateMaterial.optionGroup })
    }
}

async function createProductVariantIntermediateMaterial(
    input: CreateProductVariantIntermediateMaterialInput
): Promise<ProductVariantIntermediateMaterial> {
    await packagingService.assertPackagingHasRole(input.packagingId, "intermediate")
    const optionGroup = await resolveOptionGroupOnWrite(input.productVariantId, input.optionGroup, null)
    const isDefault = await resolveIsDefaultOnWrite(input.productVariantId, optionGroup, input.isDefault, null)
    return ProductVariantIntermediateMaterial.create({ ...input, optionGroup, isDefault })
}

async function updateProductVariantIntermediateMaterial(
    id: number,
    input: UpdateProductVariantIntermediateMaterialInput
): Promise<ProductVariantIntermediateMaterial> {
    const productVariantIntermediateMaterial = await getProductVariantIntermediateMaterialById(id)
    if (input.packagingId) await packagingService.assertPackagingHasRole(input.packagingId, "intermediate")

    const effectiveProductVariantId = input.productVariantId ?? productVariantIntermediateMaterial.productVariantId
    const effectiveRequestedIsDefault = input.isDefault ?? productVariantIntermediateMaterial.isDefault
    const optionGroup = await resolveOptionGroupOnWrite(effectiveProductVariantId, input.optionGroup, productVariantIntermediateMaterial.id)
    await assertUpdateKeepsADefault(productVariantIntermediateMaterial, effectiveProductVariantId, optionGroup, effectiveRequestedIsDefault)
    const isDefault = await resolveIsDefaultOnWrite(
        effectiveProductVariantId,
        optionGroup,
        effectiveRequestedIsDefault,
        productVariantIntermediateMaterial.id
    )
    return productVariantIntermediateMaterial.update({ ...input, optionGroup, isDefault })
}

async function deleteProductVariantIntermediateMaterial(id: number): Promise<void> {
    const productVariantIntermediateMaterial = await getProductVariantIntermediateMaterialById(id)
    await assertDeletionNotBlockedByDefault(productVariantIntermediateMaterial)
    await productVariantIntermediateMaterial.update({ isActive: false })
}

export const productVariantIntermediateMaterialService = {
    listProductVariantIntermediateMaterials,
    getProductVariantIntermediateMaterialById,
    createProductVariantIntermediateMaterial,
    updateProductVariantIntermediateMaterial,
    deleteProductVariantIntermediateMaterial,
}
