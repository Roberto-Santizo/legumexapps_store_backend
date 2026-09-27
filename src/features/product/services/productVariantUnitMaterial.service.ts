import { Op } from "sequelize"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { packagingService } from "../../packaging/services/packaging.service"
import { isSameOptionGroup, resolveOptionGroupSpelling } from "../../../shared/utils/optionGroup.util"
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

// Grupos de opciones (2026-09-24, ver CLAUDE.md #4 -- reemplaza el "un solo slot swappable por
// nivel" de 2026-09-21): una fila con optionGroup=null es receta fija (siempre se costea); las filas
// con el mismo optionGroup (comparado sin mayúsculas/espacios, ver shared/utils/optionGroup.util.ts)
// son alternativas entre sí, y grupos distintos del mismo SKU coexisten. Todas las reglas de default
// son POR GRUPO: la primera fila de un grupo se fuerza isDefault=true; pedir isDefault=true en otra
// desmarca solo a las hermanas de ESE grupo (auto-democión); una fila fija nunca queda isDefault.
// Al guardar, el nombre se normaliza y adopta la grafía de un grupo ya existente en el SKU ("caja"
// se une a "Caja"). Se leen las filas agrupadas del SKU y se filtra en memoria (pocas filas por
// variante) para que la comparación insensible a mayúsculas sea la misma que usa el motor.
async function findActiveGroupedRows(productVariantId: number, excludeId: number | null): Promise<ProductVariantUnitMaterial[]> {
    const rows = await ProductVariantUnitMaterial.findAll({
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
            await ProductVariantUnitMaterial.update(
                { isDefault: false },
                { where: { id: { [Op.in]: currentDefaults.map(sibling => sibling.id) } } }
            )
        }
    }
    return requestedIsDefault
}

async function countOtherGroupSiblings(productVariantUnitMaterial: ProductVariantUnitMaterial): Promise<number> {
    const groupedRows = await findActiveGroupedRows(productVariantUnitMaterial.productVariantId, productVariantUnitMaterial.id)
    return groupedRows.filter(row => isSameOptionGroup(row.optionGroup, productVariantUnitMaterial.optionGroup)).length
}

// Bloquea (no auto-promueve) eliminar/desactivar el default de un grupo mientras ese grupo tenga
// otras alternativas activas -- decisión de negocio 2026-09-21: el admin debe elegir otro default
// primero, nunca se cambia en silencio qué material se está costeando. La última fila de un grupo
// sí se puede eliminar (el grupo simplemente desaparece).
async function assertDeletionNotBlockedByDefault(productVariantUnitMaterial: ProductVariantUnitMaterial): Promise<void> {
    if (productVariantUnitMaterial.optionGroup === null || !productVariantUnitMaterial.isDefault) return

    if ((await countOtherGroupSiblings(productVariantUnitMaterial)) > 0) {
        throw new AppError(409, "errors.unit_material_default_deletion_blocked", { group: productVariantUnitMaterial.optionGroup })
    }
}

// Mismo criterio que assertDeletionNotBlockedByDefault, para la vía de UPDATE: quitar isDefault,
// volver la fila fija, moverla a otro grupo o a otra variante dejaría a su grupo VIEJO con
// alternativas y CERO defaults -- estado inválido que antes solo se detectaba al cotizar. Si la
// fila es la única de su grupo no hay nada que bloquear. Moverla a otro grupo como default sí está
// permitido si el viejo queda vacío; resolveIsDefaultOnWrite desmarca el default del destino.
async function assertUpdateKeepsADefault(
    productVariantUnitMaterial: ProductVariantUnitMaterial,
    willBeProductVariantId: number,
    willBeGroup: string | null,
    willBeDefault: boolean
): Promise<void> {
    const isCurrentDefault = productVariantUnitMaterial.optionGroup !== null && productVariantUnitMaterial.isDefault
    if (!isCurrentDefault) return

    const staysDefaultOfSameGroup =
        willBeDefault &&
        willBeProductVariantId === productVariantUnitMaterial.productVariantId &&
        isSameOptionGroup(willBeGroup, productVariantUnitMaterial.optionGroup)
    if (staysDefaultOfSameGroup) return

    if ((await countOtherGroupSiblings(productVariantUnitMaterial)) > 0) {
        throw new AppError(409, "errors.material_default_required", { group: productVariantUnitMaterial.optionGroup })
    }
}

async function createProductVariantUnitMaterial(
    input: CreateProductVariantUnitMaterialInput
): Promise<ProductVariantUnitMaterial> {
    await packagingService.assertPackagingHasRole(input.packagingId, "unit")
    const optionGroup = await resolveOptionGroupOnWrite(input.productVariantId, input.optionGroup, null)
    const isDefault = await resolveIsDefaultOnWrite(input.productVariantId, optionGroup, input.isDefault, null)
    return ProductVariantUnitMaterial.create({ ...input, optionGroup, isDefault })
}

async function updateProductVariantUnitMaterial(
    id: number,
    input: UpdateProductVariantUnitMaterialInput
): Promise<ProductVariantUnitMaterial> {
    const productVariantUnitMaterial = await getProductVariantUnitMaterialById(id)
    if (input.packagingId) await packagingService.assertPackagingHasRole(input.packagingId, "unit")

    const effectiveProductVariantId = input.productVariantId ?? productVariantUnitMaterial.productVariantId
    const effectiveRequestedIsDefault = input.isDefault ?? productVariantUnitMaterial.isDefault
    const optionGroup = await resolveOptionGroupOnWrite(effectiveProductVariantId, input.optionGroup, productVariantUnitMaterial.id)
    await assertUpdateKeepsADefault(productVariantUnitMaterial, effectiveProductVariantId, optionGroup, effectiveRequestedIsDefault)
    const isDefault = await resolveIsDefaultOnWrite(
        effectiveProductVariantId,
        optionGroup,
        effectiveRequestedIsDefault,
        productVariantUnitMaterial.id
    )
    return productVariantUnitMaterial.update({ ...input, optionGroup, isDefault })
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
