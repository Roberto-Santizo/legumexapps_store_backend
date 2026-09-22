import z from "zod"

const productIngredientShape = {
    productId: z.number().int().positive(),
    ingredientId: z.number().int().positive(),
    // Solo aplica cuando el producto padre es de receta fija (!isCustomizable) -- ver
    // assertPercentageIfFixedRecipe en productIngredient.service.ts, que exige este valor de
    // forma async (acá queda opcional a nivel de schema por el mismo motivo que antes exigía
    // quantityValue: el schema no sabe si el producto es customizable o no).
    percentage: z.number().positive().max(100).optional(),
    minPercentage: z.number().min(0).max(100).optional(),
    maxPercentage: z.number().min(0).max(100).optional(),
    displayOrder: z.number().int().optional(),
}

const refineMinMax = (data: { minPercentage?: number; maxPercentage?: number }) =>
    data.minPercentage === undefined || data.maxPercentage === undefined || data.minPercentage <= data.maxPercentage

export const createProductIngredientSchema = z.object(productIngredientShape).refine(refineMinMax, {
    message: "minPercentage debe ser menor o igual a maxPercentage",
    path: ["minPercentage"],
})

export const productIngredientIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateProductIngredientSchema = z.object(productIngredientShape).partial().refine(refineMinMax, {
    message: "minPercentage debe ser menor o igual a maxPercentage",
    path: ["minPercentage"],
})

export type CreateProductIngredientInput = z.infer<typeof createProductIngredientSchema>
export type UpdateProductIngredientInput = z.infer<typeof updateProductIngredientSchema>
