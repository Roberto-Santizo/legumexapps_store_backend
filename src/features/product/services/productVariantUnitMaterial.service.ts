import { Op, WhereOptions } from "sequelize"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { packagingService } from "../../packaging/services/packaging.service"
import {
    CreateProductVariantUnitMaterialInput,
    UpdateProductVariantUnitMaterialInput
} from "../schemas/productVariantUnitMaterial.schema"

async function listProductVariantUnitMaterials(): Promise<ProductVariantUnitMaterial[]> {
    return ProductVariantUnitMaterial.findAll({ where: { isActive: true } })
}

async function getProductVariantUnitMaterialById(id: number): Promise<ProductVariantUnitMaterial> {
    const productVariantUnitMaterial = await ProductVariantUnitMaterial.findOne({ where: { id, isActive: true } })
    if (!productVariantUnitMaterial) throw new NotFoundError("ProductVariantUnitMaterial", id)
    return productVariantUnitMaterial
}

// Default + opcional (2026-09-21, ver CLAUDE.md #4): entre las filas isSwappable=true de una
// misma variante, exactamente una debe ser isDefault. Si es la primera fila swappable de la
// variante, se fuerza isDefault=true sin importar lo pedido (misma conveniencia UX que el
// auto-fill de 100% en receta fija, ver productIngredientSection.component.tsx); si se pide
// isDefault=true en una fila que NO es la primera, se desmarca automáticamente cualquier otra
// fila swappable que ya fuera default (auto-democión, más amigable que rechazar). Una fila
// isSwappable=false nunca puede quedar con isDefault=true.
async function resolveIsDefaultOnWrite(
    productVariantId: number,
    isSwappable: boolean,
    requestedIsDefault: boolean,
    excludeId: number | null
): Promise<boolean> {
    if (!isSwappable) return false

    const where: WhereOptions = { productVariantId, isSwappable: true, isActive: true }
    if (excludeId !== null) where.id = { [Op.ne]: excludeId }
    const swappableSiblings = await ProductVariantUnitMaterial.findAll({ where })

    if (swappableSiblings.length === 0) return true

    if (requestedIsDefault) {
        const currentDefaults = swappableSiblings.filter(sibling => sibling.isDefault)
        if (currentDefaults.length > 0) {
            await ProductVariantUnitMaterial.update(
                { isDefault: false },
                { where: { id: { [Op.in]: currentDefaults.map(sibling => sibling.id) } } }
            )
        }
    }
    return requestedIsDefault
}

async function countOtherSwappableSiblings(productVariantUnitMaterial: ProductVariantUnitMaterial): Promise<number> {
    return ProductVariantUnitMaterial.count({
        where: {
            productVariantId: productVariantUnitMaterial.productVariantId,
            isSwappable: true,
            isActive: true,
            id: { [Op.ne]: productVariantUnitMaterial.id }
        }
    })
}

// Bloquea (no auto-promueve) eliminar/desactivar el default vigente mientras queden otras
// alternativas swappable activas -- decisión de negocio 2026-09-21: el admin debe elegir otro
// default primero, nunca se cambia en silencio qué material se está costeando.
async function assertDeletionNotBlockedByDefault(productVariantUnitMaterial: ProductVariantUnitMaterial): Promise<void> {
    if (!productVariantUnitMaterial.isSwappable || !productVariantUnitMaterial.isDefault) return

    if ((await countOtherSwappableSiblings(productVariantUnitMaterial)) > 0) {
        throw new AppError(409, "errors.unit_material_default_deletion_blocked")
    }
}

// Mismo criterio que assertDeletionNotBlockedByDefault, para la vía de UPDATE: quitar isDefault
// (o isSwappable) de la fila que hoy es el default dejaría al nivel con alternativas swappable y
// CERO defaults -- estado inválido que antes solo se detectaba al cotizar. Si la fila es la única
// swappable no hay nada que bloquear (resolveIsDefaultOnWrite la fuerza a default, o el nivel
// simplemente deja de tener menú).
async function assertUpdateKeepsADefault(
    productVariantUnitMaterial: ProductVariantUnitMaterial,
    willBeSwappable: boolean,
    willBeDefault: boolean
): Promise<void> {
    const isCurrentDefault = productVariantUnitMaterial.isSwappable && productVariantUnitMaterial.isDefault
    if (!isCurrentDefault || (willBeSwappable && willBeDefault)) return

    if ((await countOtherSwappableSiblings(productVariantUnitMaterial)) > 0) {
        throw new AppError(409, "errors.material_default_required")
    }
}

async function createProductVariantUnitMaterial(
    input: CreateProductVariantUnitMaterialInput
): Promise<ProductVariantUnitMaterial> {
    await packagingService.assertPackagingHasRole(input.packagingId, "unit")
    const isDefault = await resolveIsDefaultOnWrite(input.productVariantId, input.isSwappable, input.isDefault, null)
    return ProductVariantUnitMaterial.create({ ...input, isDefault })
}

async function updateProductVariantUnitMaterial(
    id: number,
    input: UpdateProductVariantUnitMaterialInput
): Promise<ProductVariantUnitMaterial> {
    const productVariantUnitMaterial = await getProductVariantUnitMaterialById(id)
    if (input.packagingId) await packagingService.assertPackagingHasRole(input.packagingId, "unit")

    const effectiveIsSwappable = input.isSwappable ?? productVariantUnitMaterial.isSwappable
    const effectiveRequestedIsDefault = input.isDefault ?? productVariantUnitMaterial.isDefault
    await assertUpdateKeepsADefault(productVariantUnitMaterial, effectiveIsSwappable, effectiveRequestedIsDefault)
    const isDefault = await resolveIsDefaultOnWrite(
        productVariantUnitMaterial.productVariantId,
        effectiveIsSwappable,
        effectiveRequestedIsDefault,
        productVariantUnitMaterial.id
    )
    return productVariantUnitMaterial.update({ ...input, isDefault })
}

async function deleteProductVariantUnitMaterial(id: number): Promise<void> {
    const productVariantUnitMaterial = await getProductVariantUnitMaterialById(id)
    await assertDeletionNotBlockedByDefault(productVariantUnitMaterial)
    await productVariantUnitMaterial.update({ isActive: false })
}

export const productVariantUnitMaterialService = {
    listProductVariantUnitMaterials,
    getProductVariantUnitMaterialById,
    createProductVariantUnitMaterial,
    updateProductVariantUnitMaterial,
    deleteProductVariantUnitMaterial,
}
