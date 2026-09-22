import { Op, WhereOptions } from "sequelize"
import ProductVariantIntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { packagingService } from "../../packaging/services/packaging.service"
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

// Default + opcional (2026-09-21) -- mismo criterio que
// productVariantUnitMaterial.service.ts::resolveIsDefaultOnWrite, ver el comentario ahí.
async function resolveIsDefaultOnWrite(
    productVariantId: number,
    isSwappable: boolean,
    requestedIsDefault: boolean,
    excludeId: number | null
): Promise<boolean> {
    if (!isSwappable) return false

    const where: WhereOptions = { productVariantId, isSwappable: true, isActive: true }
    if (excludeId !== null) where.id = { [Op.ne]: excludeId }
    const swappableSiblings = await ProductVariantIntermediateMaterial.findAll({ where })

    if (swappableSiblings.length === 0) return true

    if (requestedIsDefault) {
        const currentDefaults = swappableSiblings.filter(sibling => sibling.isDefault)
        if (currentDefaults.length > 0) {
            await ProductVariantIntermediateMaterial.update(
                { isDefault: false },
                { where: { id: { [Op.in]: currentDefaults.map(sibling => sibling.id) } } }
            )
        }
    }
    return requestedIsDefault
}

async function countOtherSwappableSiblings(productVariantIntermediateMaterial: ProductVariantIntermediateMaterial): Promise<number> {
    return ProductVariantIntermediateMaterial.count({
        where: {
            productVariantId: productVariantIntermediateMaterial.productVariantId,
            isSwappable: true,
            isActive: true,
            id: { [Op.ne]: productVariantIntermediateMaterial.id }
        }
    })
}

// Bloquea (no auto-promueve) eliminar/desactivar el default vigente -- mismo criterio que
// productVariantUnitMaterial.service.ts::assertDeletionNotBlockedByDefault.
async function assertDeletionNotBlockedByDefault(productVariantIntermediateMaterial: ProductVariantIntermediateMaterial): Promise<void> {
    if (!productVariantIntermediateMaterial.isSwappable || !productVariantIntermediateMaterial.isDefault) return

    if ((await countOtherSwappableSiblings(productVariantIntermediateMaterial)) > 0) {
        throw new AppError(409, "errors.intermediate_material_default_deletion_blocked")
    }
}

// Vía UPDATE del mismo bloqueo -- ver productVariantUnitMaterial.service.ts::assertUpdateKeepsADefault.
async function assertUpdateKeepsADefault(
    productVariantIntermediateMaterial: ProductVariantIntermediateMaterial,
    willBeSwappable: boolean,
    willBeDefault: boolean
): Promise<void> {
    const isCurrentDefault = productVariantIntermediateMaterial.isSwappable && productVariantIntermediateMaterial.isDefault
    if (!isCurrentDefault || (willBeSwappable && willBeDefault)) return

    if ((await countOtherSwappableSiblings(productVariantIntermediateMaterial)) > 0) {
        throw new AppError(409, "errors.material_default_required")
    }
}

// A diferencia de unit/pallet (receta: N filas fijas que TODAS se costean), el empaque intermedio
// es estructuralmente 0-o-1 -- "la bolsa grande". Dos filas fijas (isSwappable=false) en una misma
// variante serían un dato mal armado que el motor resolvería en silencio tomando solo la primera
// (subcosteo silencioso, misma clase de falla que el viejo baseFactor "costos en millones"), así
// que se rechaza al guardar. Varias filas swappable SÍ están bien (es el menú de alternativas).
async function assertAtMostOneFixedRow(
    productVariantId: number,
    isSwappable: boolean,
    excludeId: number | null
): Promise<void> {
    if (isSwappable) return

    const where: WhereOptions = { productVariantId, isSwappable: false, isActive: true }
    if (excludeId !== null) where.id = { [Op.ne]: excludeId }
    if ((await ProductVariantIntermediateMaterial.count({ where })) > 0) {
        throw new AppError(409, "errors.multiple_fixed_intermediate_materials")
    }
}

async function createProductVariantIntermediateMaterial(
    input: CreateProductVariantIntermediateMaterialInput
): Promise<ProductVariantIntermediateMaterial> {
    await packagingService.assertPackagingHasRole(input.packagingId, "intermediate")
    await assertAtMostOneFixedRow(input.productVariantId, input.isSwappable, null)
    const isDefault = await resolveIsDefaultOnWrite(input.productVariantId, input.isSwappable, input.isDefault, null)
    return ProductVariantIntermediateMaterial.create({ ...input, isDefault })
}

async function updateProductVariantIntermediateMaterial(
    id: number,
    input: UpdateProductVariantIntermediateMaterialInput
): Promise<ProductVariantIntermediateMaterial> {
    const productVariantIntermediateMaterial = await getProductVariantIntermediateMaterialById(id)
    if (input.packagingId) await packagingService.assertPackagingHasRole(input.packagingId, "intermediate")

    const effectiveIsSwappable = input.isSwappable ?? productVariantIntermediateMaterial.isSwappable
    const effectiveRequestedIsDefault = input.isDefault ?? productVariantIntermediateMaterial.isDefault
    await assertUpdateKeepsADefault(productVariantIntermediateMaterial, effectiveIsSwappable, effectiveRequestedIsDefault)
    await assertAtMostOneFixedRow(
        input.productVariantId ?? productVariantIntermediateMaterial.productVariantId,
        effectiveIsSwappable,
        productVariantIntermediateMaterial.id
    )
    const isDefault = await resolveIsDefaultOnWrite(
        productVariantIntermediateMaterial.productVariantId,
        effectiveIsSwappable,
        effectiveRequestedIsDefault,
        productVariantIntermediateMaterial.id
    )
    return productVariantIntermediateMaterial.update({ ...input, isDefault })
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
