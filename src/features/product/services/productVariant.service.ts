import { Op, WhereOptions } from "sequelize"
import ProductVariant from "../models/ProductVariant.model"
import Product from "../models/Product.model"
import Presentation from "../../presentation/models/Presentation.model"
import Packaging from "../../packaging/models/Packaging.model"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CreateProductVariantInput, ProductVariantSkuLookup, UpdateProductVariantInput } from "../schemas/productVariant.schema"

async function listProductVariants(): Promise<ProductVariant[]> {
    return ProductVariant.findAll({ where: { isActive: true }, order: [["id", "DESC"]] })
}

async function getProductVariantById(id: number): Promise<ProductVariant> {
    const productVariant = await ProductVariant.findOne({ where: { id, isActive: true } })
    if (!productVariant) throw new NotFoundError("ProductVariant", id)
    return productVariant
}

// Case-insensitive (Op.iLike) a propósito -- mismo criterio que product.service.ts::assertCodigoIsUnique
// (el usuario pidió explícitamente que dos códigos que solo difieran en mayúsculas/minúsculas
// cuenten como el mismo). El índice físico (productVariants_skuCode_unique, ver
// ProductVariant.model.ts) sigue siendo case-sensitive -- queda como defensa en profundidad para
// la ventana de carrera entre este chequeo y el INSERT/UPDATE real, no como la regla de negocio.
async function assertSkuCodeIsUnique(skuCode: string, excludeId?: number): Promise<void> {
    const where: WhereOptions = excludeId
        ? { skuCode: { [Op.iLike]: skuCode }, id: { [Op.ne]: excludeId } }
        : { skuCode: { [Op.iLike]: skuCode } }
    const existing = await ProductVariant.findOne({ where })
    if (existing) throw new AppError(409, "errors.product_variant_skucode_already_exists", { skuCode })
}

function assertIntermediatePackagingConsistency(
    intermediatePackagingId: number | null | undefined,
    unitsPerIntermediatePackage: number | null | undefined
): void {
    const hasPackaging = intermediatePackagingId !== null && intermediatePackagingId !== undefined
    const hasUnits = unitsPerIntermediatePackage !== null && unitsPerIntermediatePackage !== undefined
    if (hasPackaging !== hasUnits) {
        throw new AppError(422, "errors.intermediate_packaging_requires_units")
    }
}

async function createProductVariant(input: CreateProductVariantInput): Promise<ProductVariant> {
    await assertSkuCodeIsUnique(input.skuCode)
    assertIntermediatePackagingConsistency(input.intermediatePackagingId, input.unitsPerIntermediatePackage)
    return ProductVariant.create(input)
}

async function updateProductVariant(id: number, input: UpdateProductVariantInput): Promise<ProductVariant> {
    const productVariant = await getProductVariantById(id)

    if (input.skuCode) await assertSkuCodeIsUnique(input.skuCode, id)

    const effectiveIntermediatePackagingId = input.intermediatePackagingId !== undefined
        ? input.intermediatePackagingId
        : productVariant.intermediatePackagingId
    const effectiveUnitsPerIntermediatePackage = input.unitsPerIntermediatePackage !== undefined
        ? input.unitsPerIntermediatePackage
        : productVariant.unitsPerIntermediatePackage
    assertIntermediatePackagingConsistency(effectiveIntermediatePackagingId, effectiveUnitsPerIntermediatePackage)
    return productVariant.update(input)
}

async function deleteProductVariant(id: number): Promise<void> {
    const productVariant = await getProductVariantById(id)
    await productVariant.update({ isActive: false })
}

// Autofill del SKU (2026-09-13): búsqueda de solo lectura, sin efectos secundarios -- el frontend
// la dispara con un botón "Buscar" explícito (nunca en cada tecla), usa el resultado para
// PRELLENAR el form de creación/edición de variante (reset()), y el usuario sigue teniendo que
// pulsar "Guardar" -- ver productVariantSection.component.tsx. El backend jamás confía en que un
// valor prellenado sea correcto solo por venir de este lookup: create/updateProductVariant
// revalidan todo exactamente igual que si se hubiera tecleado a mano.
//
// Búsqueda GLOBAL (no filtrada por producto): el caso de uso real es encontrar la configuración
// de palet/receta de un SKU parecido ya cargado, sin importar a qué producto pertenece hoy --
// el admin sigue revisando todo antes de guardar, así que no hay riesgo de "inyectar" el dato
// equivocado en silencio.
async function findVariantConfigBySkuCode(skuCode: string): Promise<ProductVariantSkuLookup> {
    const variant = await ProductVariant.findOne({
        where: { skuCode: { [Op.iLike]: skuCode }, isActive: true },
        include: [
            { model: Product, as: "parentProduct" },
            { model: Presentation, as: "sizePresentation" },
            {
                model: ProductVariantUnitMaterial,
                as: "unitMaterials",
                where: { isActive: true },
                required: false,
                include: [{ model: Packaging, as: "usedUnitMaterial" }]
            },
            {
                model: ProductVariantPalletMaterial,
                as: "palletMaterials",
                where: { isActive: true },
                required: false,
                include: [{ model: Packaging, as: "usedPalletMaterial" }]
            }
        ]
    })
    if (!variant) throw new AppError(404, "errors.product_variant_sku_not_found", { skuCode })

    return {
        skuCode: variant.skuCode,
        productId: variant.productId,
        productDisplayName: variant.parentProduct?.displayName ?? "",
        presentationId: variant.presentationId ?? null,
        presentationLabel: variant.sizePresentation?.displayLabel ?? null,
        boxesPerPallet: variant.boxesPerPallet ?? null,
        bagsPerBox: variant.bagsPerBox ?? null,
        intermediatePackagingId: variant.intermediatePackagingId ?? null,
        unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage ?? null,
        unitMaterials: (variant.unitMaterials ?? []).map(material => ({
            packagingId: material.packagingId,
            displayName: material.usedUnitMaterial?.displayName ?? "",
            quantity: Number(material.quantityPerUnit)
        })),
        palletMaterials: (variant.palletMaterials ?? []).map(material => ({
            packagingId: material.packagingId,
            displayName: material.usedPalletMaterial?.displayName ?? "",
            quantity: Number(material.quantityValue)
        }))
    }
}

export const productVariantService = {
    listProductVariants,
    getProductVariantById,
    createProductVariant,
    updateProductVariant,
    deleteProductVariant,
    findVariantConfigBySkuCode,
}
