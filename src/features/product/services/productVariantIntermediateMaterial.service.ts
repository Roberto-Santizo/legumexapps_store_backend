import { Op, type Transaction } from "sequelize"
import { withMaterialWriteTransaction } from "./materialWriteTransaction"
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

async function getProductVariantIntermediateMaterialById(id: number, transaction?: Transaction): Promise<ProductVariantIntermediateMaterial> {
    const productVariantIntermediateMaterial = await ProductVariantIntermediateMaterial.findOne({ where: { id, isActive: true }, transaction })
    if (!productVariantIntermediateMaterial) throw new NotFoundError("ProductVariantIntermediateMaterial", id)
    return productVariantIntermediateMaterial
}

async function findActiveGroupedRows(productVariantId: number, excludeId: number | null, transaction: Transaction): Promise<ProductVariantIntermediateMaterial[]> {
    const rows = await ProductVariantIntermediateMaterial.findAll({
        where: { productVariantId, optionGroup: { [Op.ne]: null }, isActive: true },
        transaction
    })
    return rows.filter(row => row.id !== excludeId)
}

async function resolveOptionGroupOnWrite(
    productVariantId: number,
    requestedGroup: string | null,
    excludeId: number | null,
    transaction: Transaction
): Promise<string | null> {
    if (requestedGroup === null) return null
    const groupedRows = await findActiveGroupedRows(productVariantId, excludeId, transaction)
    return resolveOptionGroupSpelling(requestedGroup, groupedRows.map(row => row.optionGroup))
}

async function resolveIsDefaultOnWrite(
    productVariantId: number,
    optionGroup: string | null,
    requestedIsDefault: boolean,
    excludeId: number | null,
    transaction: Transaction
): Promise<boolean> {
    if (optionGroup === null) return false

    const groupSiblings = (await findActiveGroupedRows(productVariantId, excludeId, transaction))
        .filter(row => isSameOptionGroup(row.optionGroup, optionGroup))

    if (groupSiblings.length === 0) return true

    if (requestedIsDefault) {
        const currentDefaults = groupSiblings.filter(sibling => sibling.isDefault)
        if (currentDefaults.length > 0) {
            await ProductVariantIntermediateMaterial.update(
                { isDefault: false },
                { where: { id: { [Op.in]: currentDefaults.map(sibling => sibling.id) } }, transaction }
            )
        }
    }
    return requestedIsDefault
}

async function countOtherGroupSiblings(productVariantIntermediateMaterial: ProductVariantIntermediateMaterial, transaction: Transaction): Promise<number> {
    const groupedRows = await findActiveGroupedRows(productVariantIntermediateMaterial.productVariantId, productVariantIntermediateMaterial.id, transaction)
    return groupedRows.filter(row => isSameOptionGroup(row.optionGroup, productVariantIntermediateMaterial.optionGroup)).length
}

// Bloquea (no auto-promueve) eliminar/desactivar el default de un grupo con otras alternativas activas.
async function assertDeletionNotBlockedByDefault(productVariantIntermediateMaterial: ProductVariantIntermediateMaterial, transaction: Transaction): Promise<void> {
    if (productVariantIntermediateMaterial.optionGroup === null || !productVariantIntermediateMaterial.isDefault) return

    if ((await countOtherGroupSiblings(productVariantIntermediateMaterial, transaction)) > 0) {
        throw new AppError(409, "errors.intermediate_material_default_deletion_blocked", { group: productVariantIntermediateMaterial.optionGroup })
    }
}

// Mismo bloqueo por la vía de UPDATE (incluye mover el default a otro grupo).
async function assertUpdateKeepsADefault(
    productVariantIntermediateMaterial: ProductVariantIntermediateMaterial,
    willBeProductVariantId: number,
    willBeGroup: string | null,
    willBeDefault: boolean, transaction: Transaction
): Promise<void> {
    const isCurrentDefault = productVariantIntermediateMaterial.optionGroup !== null && productVariantIntermediateMaterial.isDefault
    if (!isCurrentDefault) return

    const staysDefaultOfSameGroup =
        willBeDefault &&
        willBeProductVariantId === productVariantIntermediateMaterial.productVariantId &&
        isSameOptionGroup(willBeGroup, productVariantIntermediateMaterial.optionGroup)
    if (staysDefaultOfSameGroup) return

    if ((await countOtherGroupSiblings(productVariantIntermediateMaterial, transaction)) > 0) {
        throw new AppError(409, "errors.material_default_required", { group: productVariantIntermediateMaterial.optionGroup })
    }
}

async function createProductVariantIntermediateMaterial(
    input: CreateProductVariantIntermediateMaterialInput
): Promise<ProductVariantIntermediateMaterial> {
    return withMaterialWriteTransaction(async transaction => {
        await packagingService.assertPackagingHasRole(input.packagingId, "intermediate", transaction)
        const optionGroup = await resolveOptionGroupOnWrite(input.productVariantId, input.optionGroup, null, transaction)
        const isDefault = await resolveIsDefaultOnWrite(input.productVariantId, optionGroup, input.isDefault, null, transaction)
        return ProductVariantIntermediateMaterial.create({ ...input, optionGroup, isDefault }, { transaction })
    })
}

async function updateProductVariantIntermediateMaterial(
    id: number,
    input: UpdateProductVariantIntermediateMaterialInput
): Promise<ProductVariantIntermediateMaterial> {
    return withMaterialWriteTransaction(async transaction => {
        const productVariantIntermediateMaterial = await getProductVariantIntermediateMaterialById(id, transaction)
        if (input.packagingId) await packagingService.assertPackagingHasRole(input.packagingId, "intermediate", transaction)

        const effectiveProductVariantId = input.productVariantId ?? productVariantIntermediateMaterial.productVariantId
        const effectiveRequestedIsDefault = input.isDefault ?? productVariantIntermediateMaterial.isDefault
        const optionGroup = await resolveOptionGroupOnWrite(effectiveProductVariantId, input.optionGroup, productVariantIntermediateMaterial.id, transaction)
        await assertUpdateKeepsADefault(productVariantIntermediateMaterial, effectiveProductVariantId, optionGroup, effectiveRequestedIsDefault, transaction)
        const isDefault = await resolveIsDefaultOnWrite(
            effectiveProductVariantId,
            optionGroup,
            effectiveRequestedIsDefault,
            productVariantIntermediateMaterial.id,
            transaction
        )
        return productVariantIntermediateMaterial.update({ ...input, optionGroup, isDefault }, { transaction })
    })
}

async function deleteProductVariantIntermediateMaterial(id: number): Promise<void> {
    return withMaterialWriteTransaction(async transaction => {
        const productVariantIntermediateMaterial = await getProductVariantIntermediateMaterialById(id, transaction)
        await assertDeletionNotBlockedByDefault(productVariantIntermediateMaterial, transaction)
        await productVariantIntermediateMaterial.update({ isActive: false }, { transaction })
    })
}

export const productVariantIntermediateMaterialService = {
    listProductVariantIntermediateMaterials,
    getProductVariantIntermediateMaterialById,
    createProductVariantIntermediateMaterial,
    updateProductVariantIntermediateMaterial,
    deleteProductVariantIntermediateMaterial,
}
