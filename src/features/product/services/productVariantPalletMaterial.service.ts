import { Op, WhereOptions } from "sequelize"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { packagingService } from "../../packaging/services/packaging.service"
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
    const swappableSiblings = await ProductVariantPalletMaterial.findAll({ where })

    if (swappableSiblings.length === 0) return true

    if (requestedIsDefault) {
        const currentDefaults = swappableSiblings.filter(sibling => sibling.isDefault)
        if (currentDefaults.length > 0) {
            await ProductVariantPalletMaterial.update(
                { isDefault: false },
                { where: { id: { [Op.in]: currentDefaults.map(sibling => sibling.id) } } }
            )
        }
    }
    return requestedIsDefault
}

async function countOtherSwappableSiblings(productVariantPalletMaterial: ProductVariantPalletMaterial): Promise<number> {
    return ProductVariantPalletMaterial.count({
        where: {
            productVariantId: productVariantPalletMaterial.productVariantId,
            isSwappable: true,
            isActive: true,
            id: { [Op.ne]: productVariantPalletMaterial.id }
        }
    })
}

// Bloquea (no auto-promueve) eliminar/desactivar el default vigente -- mismo criterio que
// productVariantUnitMaterial.service.ts::assertDeletionNotBlockedByDefault.
async function assertDeletionNotBlockedByDefault(productVariantPalletMaterial: ProductVariantPalletMaterial): Promise<void> {
    if (!productVariantPalletMaterial.isSwappable || !productVariantPalletMaterial.isDefault) return

    if ((await countOtherSwappableSiblings(productVariantPalletMaterial)) > 0) {
        throw new AppError(409, "errors.pallet_material_default_deletion_blocked")
    }
}

// Vía UPDATE del mismo bloqueo -- ver productVariantUnitMaterial.service.ts::assertUpdateKeepsADefault.
async function assertUpdateKeepsADefault(
    productVariantPalletMaterial: ProductVariantPalletMaterial,
    willBeSwappable: boolean,
    willBeDefault: boolean
): Promise<void> {
    const isCurrentDefault = productVariantPalletMaterial.isSwappable && productVariantPalletMaterial.isDefault
    if (!isCurrentDefault || (willBeSwappable && willBeDefault)) return

    if ((await countOtherSwappableSiblings(productVariantPalletMaterial)) > 0) {
        throw new AppError(409, "errors.material_default_required")
    }
}

async function createProductVariantPalletMaterial(
    input: CreateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    await packagingService.assertPackagingHasRole(input.packagingId, "pallet")
    const isDefault = await resolveIsDefaultOnWrite(input.productVariantId, input.isSwappable, input.isDefault, null)
    return ProductVariantPalletMaterial.create({ ...input, isDefault })
}

async function updateProductVariantPalletMaterial(
    id: number,
    input: UpdateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    const productVariantPalletMaterial = await getProductVariantPalletMaterialById(id)
    if (input.packagingId) await packagingService.assertPackagingHasRole(input.packagingId, "pallet")

    const effectiveIsSwappable = input.isSwappable ?? productVariantPalletMaterial.isSwappable
    const effectiveRequestedIsDefault = input.isDefault ?? productVariantPalletMaterial.isDefault
    await assertUpdateKeepsADefault(productVariantPalletMaterial, effectiveIsSwappable, effectiveRequestedIsDefault)
    const isDefault = await resolveIsDefaultOnWrite(
        productVariantPalletMaterial.productVariantId,
        effectiveIsSwappable,
        effectiveRequestedIsDefault,
        productVariantPalletMaterial.id
    )
    return productVariantPalletMaterial.update({ ...input, isDefault })
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
