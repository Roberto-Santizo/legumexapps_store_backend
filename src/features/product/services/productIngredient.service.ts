import ProductIngredient from "../models/ProductIngredient.model"
import Product from "../models/Product.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CreateProductIngredientInput, UpdateProductIngredientInput } from "../schemas/productIngredient.schema"

// Ingredientes agregados (sal, azúcar...) -- a diferencia de productRawMaterial.service.ts NO hay
// regla de 100% ni diferencia entre receta fija y personalizable: el admin los fija y el cliente
// nunca los toca, en ambos tipos de producto. Opcionales: un producto sin filas cotiza $0 acá.

async function listProductIngredients(): Promise<ProductIngredient[]> {
    return ProductIngredient.findAll({ where: { isActive: true }, order: [["displayOrder", "DESC"]] })
}

async function getProductIngredientById(id: number): Promise<ProductIngredient> {
    const productIngredient = await ProductIngredient.findOne({ where: { id, isActive: true } })
    if (!productIngredient) throw new NotFoundError("ProductIngredient", id)
    return productIngredient
}

async function assertProductExists(productId: number): Promise<void> {
    const product = await Product.findOne({ where: { id: productId, isActive: true } })
    if (!product) throw new NotFoundError("Product", productId)
}

async function assertIngredientIsActive(ingredientId: number): Promise<void> {
    const ingredient = await Ingredient.findOne({ where: { id: ingredientId, isActive: true } })
    if (!ingredient) throw new NotFoundError("Ingredient", ingredientId)
}

// Guard contra errores de tipeo: más gramos que el peso de la presentación sería >100% del peso.
function assertGramsWithinReference(grams: number, referenceNetWeightGrams: number): void {
    if (grams > referenceNetWeightGrams) {
        throw new AppError(422, "errors.product_ingredient_grams_exceed_reference", { grams, referenceNetWeightGrams })
    }
}

async function createProductIngredient(input: CreateProductIngredientInput): Promise<ProductIngredient> {
    assertGramsWithinReference(input.grams, input.referenceNetWeightGrams)
    await assertProductExists(input.productId)
    await assertIngredientIsActive(input.ingredientId)
    return ProductIngredient.create(input)
}

async function updateProductIngredient(id: number, input: UpdateProductIngredientInput): Promise<ProductIngredient> {
    const productIngredient = await getProductIngredientById(id)
    assertGramsWithinReference(input.grams, input.referenceNetWeightGrams)
    if (input.productId !== undefined && input.productId !== productIngredient.productId) {
        await assertProductExists(input.productId)
    }
    if (input.ingredientId !== undefined) {
        await assertIngredientIsActive(input.ingredientId)
    }
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
