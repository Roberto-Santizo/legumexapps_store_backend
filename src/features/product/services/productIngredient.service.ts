import ProductIngredient from "../models/ProductIngredient.model"
import Product from "../models/Product.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CreateProductIngredientInput, UpdateProductIngredientInput } from "../schemas/productIngredient.schema"

// Misma tolerancia que quoteService.MIX_PERCENTAGE_TOLERANCE (±0.5) -- este guard es un techo
// "blando" a nivel de escritura (ver assertFixedRecipePercentageCeiling abajo), la validación
// autoritativa de "debe sumar exactamente 100" vive en quote.service.ts al momento de cotizar,
// no acá (acá se permite guardar una receta incompleta mientras se arma fila por fila).
const FIXED_RECIPE_PERCENTAGE_TOLERANCE = 0.5

async function listProductIngredients(): Promise<ProductIngredient[]> {
    return ProductIngredient.findAll({ where: { isActive: true }, order: [["displayOrder", "DESC"]] })
}

async function getProductIngredientById(id: number): Promise<ProductIngredient> {
    const productIngredient = await ProductIngredient.findOne({ where: { id, isActive: true } })
    if (!productIngredient) throw new NotFoundError("ProductIngredient", id)
    return productIngredient
}


async function assertIngredientIsMixableIfNeeded(productId: number, ingredientId: number): Promise<void> {
    const product = await Product.findOne({ where: { id: productId } })
    if (!product?.isCustomizable) return

    const ingredient = await Ingredient.findOne({ where: { id: ingredientId } })
    if (!ingredient?.isMixable) {
        throw new AppError(422, "errors.ingredient_not_mixable", { ingredientId })
    }
}


async function assertIngredientIsOrganicCompatibleIfNeeded(productId: number, ingredientId: number): Promise<void> {
    const product = await Product.findOne({ where: { id: productId } })
    if (!product?.isOrganic) return

    const ingredient = await Ingredient.findOne({ where: { id: ingredientId } })
    if (!ingredient?.isOrganic && ingredient?.ingredientType !== "other") {
        throw new AppError(422, "errors.ingredient_not_organic_compatible", { ingredientId })
    }
}

async function assertPercentageIfFixedRecipe(productId: number, percentage: number | null | undefined): Promise<void> {
    const product = await Product.findOne({ where: { id: productId } })
    if (product?.isCustomizable) return

    if (percentage === null || percentage === undefined || percentage <= 0) {
        throw new AppError(422, "errors.product_ingredient_percentage_required")
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
    excludeIngredientRowId: number | null,
    percentage: number | null | undefined
): Promise<void> {
    const product = await Product.findOne({ where: { id: productId } })
    if (product?.isCustomizable) return
    if (percentage === null || percentage === undefined) return // assertPercentageIfFixedRecipe ya lo rechaza

    const siblings = await ProductIngredient.findAll({ where: { productId, isActive: true } })
    const othersTotal = siblings
        .filter(sibling => sibling.id !== excludeIngredientRowId)
        .reduce((sum, sibling) => sum + Number(sibling.percentage ?? 0), 0)

    const projectedTotal = othersTotal + Number(percentage)
    if (projectedTotal - 100 > FIXED_RECIPE_PERCENTAGE_TOLERANCE) {
        throw new AppError(422, "errors.product_ingredient_percentage_ceiling_exceeded", {
            projectedTotal: Math.round(projectedTotal * 100) / 100
        })
    }
}

async function createProductIngredient(input: CreateProductIngredientInput): Promise<ProductIngredient> {
    await assertIngredientIsMixableIfNeeded(input.productId, input.ingredientId)
    await assertIngredientIsOrganicCompatibleIfNeeded(input.productId, input.ingredientId)
    await assertPercentageIfFixedRecipe(input.productId, input.percentage)
    await assertFixedRecipePercentageCeiling(input.productId, null, input.percentage)
    return ProductIngredient.create(input)
}

async function updateProductIngredient(id: number, input: UpdateProductIngredientInput): Promise<ProductIngredient> {
    const productIngredient = await getProductIngredientById(id)
    const effectiveProductId = input.productId ?? productIngredient.productId
    if (input.ingredientId !== undefined) {
        await assertIngredientIsMixableIfNeeded(effectiveProductId, input.ingredientId)
        await assertIngredientIsOrganicCompatibleIfNeeded(effectiveProductId, input.ingredientId)
    }

    const effectivePercentage = input.percentage !== undefined
        ? input.percentage
        : (productIngredient.percentage !== null && productIngredient.percentage !== undefined ? Number(productIngredient.percentage) : null)
    await assertPercentageIfFixedRecipe(effectiveProductId, effectivePercentage)
    await assertFixedRecipePercentageCeiling(effectiveProductId, productIngredient.id, effectivePercentage)
    return productIngredient.update(input)
}

async function deleteProductIngredient(id: number): Promise<void> {
    const productIngredient = await getProductIngredientById(id)
    await productIngredient.update({ isActive: false })
}

export const productIngredientService = {
    listProductIngredients,
    getProductIngredientById,
    createProductIngredient,
    updateProductIngredient,
    deleteProductIngredient,
}
