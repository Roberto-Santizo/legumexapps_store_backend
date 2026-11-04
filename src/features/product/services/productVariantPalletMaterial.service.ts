import { withMaterialWriteTransaction } from "./materialWriteTransaction"
import { resolvePalletConsumptionRule } from "../../packaging/services/packagingConsumption.service"
import ProductVariant from "../models/ProductVariant.model"
import { Op, type Transaction } from "sequelize"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { packagingService } from "../../packaging/services/packaging.service"
import { isPalletKitType } from "../../packaging/constants/packagingMaterialType.constant"
import type Packaging from "../../packaging/models/Packaging.model"
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

async function getProductVariantPalletMaterialById(id: number, transaction?: Transaction): Promise<ProductVariantPalletMaterial> {
    const productVariantPalletMaterial = await ProductVariantPalletMaterial.findOne({ where: { id, isActive: true }, transaction })
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
async function findActiveGroupedRows(productVariantId: number, excludeId: number | null, transaction: Transaction): Promise<ProductVariantPalletMaterial[]> {
    const rows = await ProductVariantPalletMaterial.findAll({
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
    optionGroupId: number | null | undefined,
    transaction: Transaction
): Promise<boolean> {
    if (optionGroup === null) return false

    const groupSiblings = (await findActiveGroupedRows(productVariantId, excludeId, transaction))
        .filter(row => materialGroupIdentity(row) === materialGroupIdentity({ optionGroup, optionGroupId }))

    if (groupSiblings.length === 0) return true

    if (requestedIsDefault) {
        const currentDefaults = groupSiblings.filter(sibling => sibling.isDefault)
        if (currentDefaults.length > 0) {
            await ProductVariantPalletMaterial.update(
                { isDefault: false },
                { where: { id: { [Op.in]: currentDefaults.map(sibling => sibling.id) } }, transaction }
            )
        }
    }
    return requestedIsDefault
}

async function countOtherGroupSiblings(productVariantPalletMaterial: ProductVariantPalletMaterial, transaction: Transaction): Promise<number> {
    const groupedRows = await findActiveGroupedRows(productVariantPalletMaterial.productVariantId, productVariantPalletMaterial.id, transaction)
    return groupedRows.filter(row => materialGroupIdentity(row) === materialGroupIdentity(productVariantPalletMaterial)).length
}

// Bloquea (no auto-promueve) eliminar/desactivar el default de un grupo mientras ese grupo tenga
// otras alternativas activas -- decisión de negocio: el admin debe elegir otro default
// primero, nunca se cambia en silencio qué material se está costeando. La última fila de un grupo
// sí se puede eliminar (el grupo simplemente desaparece).
async function assertDeletionNotBlockedByDefault(productVariantPalletMaterial: ProductVariantPalletMaterial, transaction: Transaction): Promise<void> {
    if (productVariantPalletMaterial.optionGroup === null || !productVariantPalletMaterial.isDefault) return

    if ((await countOtherGroupSiblings(productVariantPalletMaterial, transaction)) > 0) {
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
    willBeGroupId: number | null | undefined,
    transaction: Transaction
): Promise<void> {
    const isCurrentDefault = productVariantPalletMaterial.optionGroup !== null && productVariantPalletMaterial.isDefault
    if (!isCurrentDefault) return

    const staysDefaultOfSameGroup =
        willBeDefault &&
        willBeProductVariantId === productVariantPalletMaterial.productVariantId &&
        materialGroupIdentity({ optionGroup: willBeGroup, optionGroupId: willBeGroupId }) === materialGroupIdentity(productVariantPalletMaterial)
    if (staysDefaultOfSameGroup) return

    if ((await countOtherGroupSiblings(productVariantPalletMaterial, transaction)) > 0) {
        throw new AppError(409, "errors.material_default_required", { group: productVariantPalletMaterial.optionGroup })
    }
}

async function assertSameGroupQuantity(productVariantId: number, group: { optionGroupId: number | null; optionGroup: string | null }, quantityBasis: string, quantityValue: number, excludeId: number | null, transaction: Transaction): Promise<void> {
    if (materialGroupIdentity(group) === null) return
    const siblings = (await findActiveGroupedRows(productVariantId, excludeId, transaction))
        .filter(row => materialGroupIdentity(row) === materialGroupIdentity(group))
    if (siblings.some(row => row.quantityBasis !== quantityBasis || Number(row.quantityValue) !== quantityValue)) {
        throw new AppError(422, "errors.pallet_material_group_quantity_mismatch")
    }
}

async function assertVariantSupportsRule(id: number, basis: string, transaction: Transaction): Promise<void> {
    if (basis !== "per_box") return
    const variant = await ProductVariant.findOne({ where: { id, isActive: true }, transaction })
    if (!variant || !Number.isFinite(Number(variant.boxesPerPallet)) || !(Number(variant.boxesPerPallet) > 0)) throw new AppError(422, "errors.pallet_boxes_required")
}

// A SKU that uses the pallet kit already gets tarima, esquineros and stretch per pallet; repeating them charges twice.
async function assertNotCoveredByPalletKit(productVariantId: number, packaging: Packaging | null, transaction: Transaction): Promise<void> {
    if (!packaging || !isPalletKitType(packaging.materialType)) return
    const variant = await ProductVariant.findOne({ where: { id: productVariantId }, attributes: ["id", "usesPalletKit"], transaction })
    if (variant?.usesPalletKit) throw new AppError(422, "errors.pallet_material_in_kit")
}

async function createProductVariantPalletMaterial(
    input: CreateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    return withMaterialWriteTransaction(async transaction => {
        const packaging = await packagingService.assertPackagingHasRole(input.packagingId, "pallet", transaction)
        await assertNotCoveredByPalletKit(input.productVariantId, packaging, transaction)
        const rule = resolvePalletConsumptionRule(packaging ?? { code: String(input.packagingId) }, input)
        await assertVariantSupportsRule(input.productVariantId, rule.quantityBasis, transaction)
        const group = await resolveUnitMaterialGroup(input.optionGroupId, input.optionGroup, undefined, transaction)
        const optionGroup = group.optionGroupId != null ? group.optionGroup : await resolveOptionGroupOnWrite(input.productVariantId, group.optionGroup, null, transaction)
        await assertSameGroupQuantity(input.productVariantId, group, rule.quantityBasis, rule.quantityValue, null, transaction)
        const isDefault = await resolveIsDefaultOnWrite(input.productVariantId, optionGroup, input.isDefault, null, group.optionGroupId, transaction)
        return ProductVariantPalletMaterial.create({ ...input, ...rule, optionGroup, optionGroupId: group.optionGroupId, isDefault }, { transaction })
    })
}

async function updateProductVariantPalletMaterial(
    id: number,
    input: UpdateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    return withMaterialWriteTransaction(async transaction => {
        const productVariantPalletMaterial = await getProductVariantPalletMaterialById(id, transaction)
        const sameMaterial = input.packagingId == null || input.packagingId === productVariantPalletMaterial.packagingId
        const packaging = input.packagingId ? await packagingService.assertPackagingHasRole(input.packagingId, "pallet", transaction) : null
        const rule = resolvePalletConsumptionRule(packaging ?? { code: String(productVariantPalletMaterial.packagingId) }, input,
            sameMaterial ? { quantityBasis: productVariantPalletMaterial.quantityBasis, quantityValue: Number(productVariantPalletMaterial.quantityValue) } : undefined)

        const effectiveProductVariantId = input.productVariantId ?? productVariantPalletMaterial.productVariantId
        await assertNotCoveredByPalletKit(effectiveProductVariantId, packaging, transaction)
        await assertVariantSupportsRule(effectiveProductVariantId, rule.quantityBasis, transaction)
        const effectiveRequestedIsDefault = input.isDefault ?? productVariantPalletMaterial.isDefault
        const group = await resolveUnitMaterialGroup(input.optionGroupId, input.optionGroup, productVariantPalletMaterial.optionGroupId, transaction)
        const optionGroup = group.optionGroupId != null ? group.optionGroup : await resolveOptionGroupOnWrite(effectiveProductVariantId, group.optionGroup, productVariantPalletMaterial.id, transaction)
        await assertSameGroupQuantity(effectiveProductVariantId, group, rule.quantityBasis, rule.quantityValue, productVariantPalletMaterial.id, transaction)
        await assertUpdateKeepsADefault(productVariantPalletMaterial, effectiveProductVariantId, optionGroup, effectiveRequestedIsDefault, group.optionGroupId, transaction)
        const isDefault = await resolveIsDefaultOnWrite(
            effectiveProductVariantId,
            optionGroup,
            effectiveRequestedIsDefault,
            productVariantPalletMaterial.id,
            group.optionGroupId,
            transaction
        )
        return productVariantPalletMaterial.update({ ...input, ...rule, optionGroup, optionGroupId: group.optionGroupId, isDefault }, { transaction })
    })
}

async function deleteProductVariantPalletMaterial(id: number): Promise<void> {
    return withMaterialWriteTransaction(async transaction => {
        const productVariantPalletMaterial = await getProductVariantPalletMaterialById(id, transaction)
        await assertDeletionNotBlockedByDefault(productVariantPalletMaterial, transaction)
        await productVariantPalletMaterial.update({ isActive: false }, { transaction })
    })
}

export const productVariantPalletMaterialService = {
    listProductVariantPalletMaterials,
    getProductVariantPalletMaterialById,
    createProductVariantPalletMaterial,
    updateProductVariantPalletMaterial,
    deleteProductVariantPalletMaterial,
}
