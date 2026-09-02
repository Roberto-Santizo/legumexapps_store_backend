import ProductIngredient from "../models/ProductIngredient.model"
import Product from "../models/Product.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CreateProductIngredientInput, UpdateProductIngredientInput } from "../schemas/productIngredient.schema"

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

async function assertQuantityValueIfFixedRecipe(productId: number, quantityValue: number | null | undefined): Promise<void> {
    const product = await Product.findOne({ where: { id: productId } })
    if (product?.isCustomizable) return

    if (quantityValue === null || quantityValue === undefined || quantityValue <= 0) {
        throw new AppError(422, "errors.product_ingredient_quantity_required")
    }
}

async function createProductIngredient(input: CreateProductIngredientInput): Promise<ProductIngredient> {
    await assertIngredientIsMixableIfNeeded(input.productId, input.ingredientId)
    await assertIngredientIsOrganicCompatibleIfNeeded(input.productId, input.ingredientId)
    await assertQuantityValueIfFixedRecipe(input.productId, input.quantityValue)
    return ProductIngredient.create(input)
}

async function updateProductIngredient(id: number, input: UpdateProductIngredientInput): Promise<ProductIngredient> {
    const productIngredient = await getProductIngredientById(id)
    const effectiveProductId = input.productId ?? productIngredient.productId
    if (input.ingredientId !== undefined) {
        await assertIngredientIsMixableIfNeeded(effectiveProductId, input.ingredientId)
        await assertIngredientIsOrganicCompatibleIfNeeded(effectiveProductId, input.ingredientId)
    }

    const effectiveQuantityValue = input.quantityValue !== undefined ? input.quantityValue : productIngredient.quantityValue
    await assertQuantityValueIfFixedRecipe(effectiveProductId, effectiveQuantityValue)
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
