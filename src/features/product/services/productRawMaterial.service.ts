import ProductRawMaterial from "../models/ProductRawMaterial.model"
import Product from "../models/Product.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CreateProductRawMaterialInput, UpdateProductRawMaterialInput } from "../schemas/productRawMaterial.schema"

// Misma tolerancia que el mix (±0.5). Este guard es un techo "blando" de escritura; la validación
// de que la receta sume exactamente 100 vive en el cálculo de la cotización.
const FIXED_RECIPE_PERCENTAGE_TOLERANCE = 0.5

async function listProductRawMaterials(): Promise<ProductRawMaterial[]> {
    return ProductRawMaterial.findAll({ where: { isActive: true }, order: [["displayOrder", "DESC"]] })
}

async function getProductRawMaterialById(id: number): Promise<ProductRawMaterial> {
    const productRawMaterial = await ProductRawMaterial.findOne({ where: { id, isActive: true } })
    if (!productRawMaterial) throw new NotFoundError("ProductRawMaterial", id)
    return productRawMaterial
}


async function assertRawMaterialIsMixableIfNeeded(productId: number, rawMaterialId: number): Promise<void> {
    const product = await Product.findOne({ where: { id: productId } })
    if (!product?.isCustomizable) return

    const rawMaterial = await RawMaterial.findOne({ where: { id: rawMaterialId } })
    if (!rawMaterial?.isMixable) {
        throw new AppError(422, "errors.raw_material_not_mixable", { rawMaterialId })
    }
}


async function assertRawMaterialIsOrganicCompatibleIfNeeded(productId: number, rawMaterialId: number): Promise<void> {
    const product = await Product.findOne({ where: { id: productId } })
    if (!product?.isOrganic) return

    const rawMaterial = await RawMaterial.findOne({ where: { id: rawMaterialId } })
    if (!rawMaterial?.isOrganic && rawMaterial?.ingredientType !== "other") {
        throw new AppError(422, "errors.raw_material_not_organic_compatible", { rawMaterialId })
    }
}

async function assertPercentageIfFixedRecipe(productId: number, percentage: number | null | undefined): Promise<void> {
    const product = await Product.findOne({ where: { id: productId } })
    if (product?.isCustomizable) return

    if (percentage === null || percentage === undefined || percentage <= 0) {
        throw new AppError(422, "errors.product_raw_material_percentage_required")
    }
}

// Techo "blando" a nivel de escritura (ver comentario junto a la constante, arriba): permite
// guardar una receta fija incompleta (< 100%) mientras el admin la arma fila por fila -- el
// backend nunca puede saber si la fila que se está guardando es la última del producto o no --
// pero nunca deja que la suma de las filas activas SUPERE 100 (+ tolerancia). La validación
// autoritativa de "debe sumar EXACTAMENTE 100" vive en quoteService.buildFixedPercentageRawMaterials,
// al momento de cotizar (ahí sí se sabe que la receta ya debería estar completa).
async function assertFixedRecipePercentageCeiling(
    productId: number,
    excludeRawMaterialRowId: number | null,
    percentage: number | null | undefined
): Promise<void> {
    const product = await Product.findOne({ where: { id: productId } })
    if (product?.isCustomizable) return
    if (percentage === null || percentage === undefined) return // assertPercentageIfFixedRecipe ya lo rechaza

    const siblings = await ProductRawMaterial.findAll({ where: { productId, isActive: true } })
    const othersTotal = siblings
        .filter(sibling => sibling.id !== excludeRawMaterialRowId)
        .reduce((sum, sibling) => sum + Number(sibling.percentage ?? 0), 0)

    const projectedTotal = othersTotal + Number(percentage)
    if (projectedTotal - 100 > FIXED_RECIPE_PERCENTAGE_TOLERANCE) {
        throw new AppError(422, "errors.product_raw_material_percentage_ceiling_exceeded", {
            projectedTotal: Math.round(projectedTotal * 100) / 100
        })
    }
}

async function createProductRawMaterial(input: CreateProductRawMaterialInput): Promise<ProductRawMaterial> {
    await assertRawMaterialIsMixableIfNeeded(input.productId, input.rawMaterialId)
    await assertRawMaterialIsOrganicCompatibleIfNeeded(input.productId, input.rawMaterialId)
    await assertPercentageIfFixedRecipe(input.productId, input.percentage)
    await assertFixedRecipePercentageCeiling(input.productId, null, input.percentage)
    return ProductRawMaterial.create(input)
}

async function updateProductRawMaterial(id: number, input: UpdateProductRawMaterialInput): Promise<ProductRawMaterial> {
    const productRawMaterial = await getProductRawMaterialById(id)
    const effectiveProductId = input.productId ?? productRawMaterial.productId
    if (input.rawMaterialId !== undefined) {
        await assertRawMaterialIsMixableIfNeeded(effectiveProductId, input.rawMaterialId)
        await assertRawMaterialIsOrganicCompatibleIfNeeded(effectiveProductId, input.rawMaterialId)
    }

    const effectivePercentage = input.percentage !== undefined
        ? input.percentage
        : (productRawMaterial.percentage !== null && productRawMaterial.percentage !== undefined ? Number(productRawMaterial.percentage) : null)
    await assertPercentageIfFixedRecipe(effectiveProductId, effectivePercentage)
    await assertFixedRecipePercentageCeiling(effectiveProductId, productRawMaterial.id, effectivePercentage)
    return productRawMaterial.update(input)
}

async function deleteProductRawMaterial(id: number): Promise<void> {
    const productRawMaterial = await getProductRawMaterialById(id)
    await productRawMaterial.update({ isActive: false })
}

export const productRawMaterialService = {
    listProductRawMaterials,
    getProductRawMaterialById,
    createProductRawMaterial,
    updateProductRawMaterial,
    deleteProductRawMaterial,
}
