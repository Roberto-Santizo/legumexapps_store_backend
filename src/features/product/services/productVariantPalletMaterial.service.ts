import { resolvePalletConsumptionRule } from "../../packaging/services/packagingConsumption.service"
import ProductVariant from "../models/ProductVariant.model"
import { Op } from "sequelize"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { packagingService } from "../../packaging/services/packaging.service"
import { resolveOptionGroupSpelling } from "../../../shared/utils/optionGroup.util"
import { materialGroupIdentity } from "../../../shared/utils/materialGroupIdentity.util"
import { resolveUnitMaterialGroup } from "../../packagingGroup/services/packagingGroup.service"
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

// Grupos de opciones: una fila con optionGroup=null es receta fija (siempre se costea); las filas
// con el mismo optionGroup (comparado sin mayúsculas/espacios, ver shared/utils/optionGroup.util.ts)
// son alternativas entre sí, y grupos distintos del mismo SKU coexisten. Todas las reglas de default
// son POR GRUPO: la primera fila de un grupo se fuerza isDefault=true; pedir isDefault=true en otra
// desmarca solo a las hermanas de ESE grupo (auto-democión); una fila fija nunca queda isDefault.
// Al guardar, el nombre se normaliza y adopta la grafía de un grupo ya existente en el SKU ("caja"
// se une a "Caja"). Se leen las filas agrupadas del SKU y se filtra en memoria (pocas filas por
// variante) para que la comparación insensible a mayúsculas sea la misma que usa el motor.
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
    excludeId: number | null,
    optionGroupId?: number | null
): Promise<boolean> {
    if (optionGroup === null) return false

    const groupSiblings = (await findActiveGroupedRows(productVariantId, excludeId))
        .filter(row => materialGroupIdentity(row) === materialGroupIdentity({ optionGroup, optionGroupId }))

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
    return groupedRows.filter(row => materialGroupIdentity(row) === materialGroupIdentity(productVariantPalletMaterial)).length
}

// Bloquea (no auto-promueve) eliminar/desactivar el default de un grupo mientras ese grupo tenga
// otras alternativas activas -- decisión de negocio: el admin debe elegir otro default
// primero, nunca se cambia en silencio qué material se está costeando. La última fila de un grupo
// sí se puede eliminar (el grupo simplemente desaparece).
async function assertDeletionNotBlockedByDefault(productVariantPalletMaterial: ProductVariantPalletMaterial): Promise<void> {
    if (productVariantPalletMaterial.optionGroup === null || !productVariantPalletMaterial.isDefault) return

    if ((await countOtherGroupSiblings(productVariantPalletMaterial)) > 0) {
        throw new AppError(409, "errors.pallet_material_default_deletion_blocked", { group: productVariantPalletMaterial.optionGroup })
    }
}

// Mismo criterio que assertDeletionNotBlockedByDefault, para la vía de UPDATE: quitar isDefault,
// volver la fila fija, moverla a otro grupo o a otra variante dejaría a su grupo VIEJO con
// alternativas y CERO defaults. Si la fila es la única de su grupo no hay nada que bloquear. Moverla
// a otro grupo como default sí está permitido; resolveIsDefaultOnWrite desmarca el default del destino.
async function assertUpdateKeepsADefault(
    productVariantPalletMaterial: ProductVariantPalletMaterial,
    willBeProductVariantId: number,
    willBeGroup: string | null,
    willBeDefault: boolean,
    willBeGroupId?: number | null
): Promise<void> {
    const isCurrentDefault = productVariantPalletMaterial.optionGroup !== null && productVariantPalletMaterial.isDefault
    if (!isCurrentDefault) return

    const staysDefaultOfSameGroup =
        willBeDefault &&
        willBeProductVariantId === productVariantPalletMaterial.productVariantId &&
        materialGroupIdentity({ optionGroup: willBeGroup, optionGroupId: willBeGroupId }) === materialGroupIdentity(productVariantPalletMaterial)
    if (staysDefaultOfSameGroup) return

    if ((await countOtherGroupSiblings(productVariantPalletMaterial)) > 0) {
        throw new AppError(409, "errors.material_default_required", { group: productVariantPalletMaterial.optionGroup })
    }
}

async function assertSameGroupQuantity(productVariantId: number, group: { optionGroupId: number | null; optionGroup: string | null }, quantityBasis: string, quantityValue: number, excludeId: number | null): Promise<void> {
    if (materialGroupIdentity(group) === null) return
    const siblings = (await findActiveGroupedRows(productVariantId, excludeId))
        .filter(row => materialGroupIdentity(row) === materialGroupIdentity(group))
    if (siblings.some(row => row.quantityBasis !== quantityBasis || Number(row.quantityValue) !== quantityValue)) {
        throw new AppError(422, "errors.pallet_material_group_quantity_mismatch")
    }
}

async function assertVariantSupportsRule(id: number, basis: string): Promise<void> {
    if (basis !== "per_box") return
    const variant = await ProductVariant.findOne({ where: { id, isActive: true } })
    if (!variant || !Number.isFinite(Number(variant.boxesPerPallet)) || !(Number(variant.boxesPerPallet) > 0)) throw new AppError(422, "errors.pallet_boxes_required")
}

async function createProductVariantPalletMaterial(
    input: CreateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    const packaging = await packagingService.assertPackagingHasRole(input.packagingId, "pallet")
    const rule = resolvePalletConsumptionRule(packaging ?? { code: String(input.packagingId) }, input)
    await assertVariantSupportsRule(input.productVariantId, rule.quantityBasis)
    const group = await resolveUnitMaterialGroup(input.optionGroupId, input.optionGroup)
    const optionGroup = group.optionGroupId != null ? group.optionGroup : await resolveOptionGroupOnWrite(input.productVariantId, group.optionGroup, null)
    await assertSameGroupQuantity(input.productVariantId, group, rule.quantityBasis, rule.quantityValue, null)
    const isDefault = await resolveIsDefaultOnWrite(input.productVariantId, optionGroup, input.isDefault, null, group.optionGroupId)
    return ProductVariantPalletMaterial.create({ ...input, ...rule, optionGroup, optionGroupId: group.optionGroupId, isDefault })
}

async function updateProductVariantPalletMaterial(
    id: number,
    input: UpdateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    const productVariantPalletMaterial = await getProductVariantPalletMaterialById(id)
    const sameMaterial = input.packagingId == null || input.packagingId === productVariantPalletMaterial.packagingId
    const packaging = input.packagingId ? await packagingService.assertPackagingHasRole(input.packagingId, "pallet") : null
    const rule = resolvePalletConsumptionRule(packaging ?? { code: String(productVariantPalletMaterial.packagingId) }, input,
        sameMaterial ? { quantityBasis: productVariantPalletMaterial.quantityBasis, quantityValue: Number(productVariantPalletMaterial.quantityValue) } : undefined)

    const effectiveProductVariantId = input.productVariantId ?? productVariantPalletMaterial.productVariantId
    await assertVariantSupportsRule(effectiveProductVariantId, rule.quantityBasis)
    const effectiveRequestedIsDefault = input.isDefault ?? productVariantPalletMaterial.isDefault
    const group = await resolveUnitMaterialGroup(input.optionGroupId, input.optionGroup, productVariantPalletMaterial.optionGroupId)
    const optionGroup = group.optionGroupId != null ? group.optionGroup : await resolveOptionGroupOnWrite(effectiveProductVariantId, group.optionGroup, productVariantPalletMaterial.id)
    await assertSameGroupQuantity(effectiveProductVariantId, group, rule.quantityBasis, rule.quantityValue, productVariantPalletMaterial.id)
    await assertUpdateKeepsADefault(productVariantPalletMaterial, effectiveProductVariantId, optionGroup, effectiveRequestedIsDefault, group.optionGroupId)
    const isDefault = await resolveIsDefaultOnWrite(
        effectiveProductVariantId,
        optionGroup,
        effectiveRequestedIsDefault,
        productVariantPalletMaterial.id,
        group.optionGroupId
    )
    return productVariantPalletMaterial.update({ ...input, ...rule, optionGroup, optionGroupId: group.optionGroupId, isDefault })
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
