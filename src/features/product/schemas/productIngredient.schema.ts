import z from "zod"

// Ingrediente agregado a un producto (sal, azúcar...) -- gramos medidos sobre una presentación de
// referencia, ver ProductIngredient.model.ts. grams > referenceNetWeightGrams se rechaza en el
// servicio (productIngredient.service.ts::assertGramsWithinReference), porque en un update hay que
// comparar contra los valores efectivos (fila guardada + input), no solo el body.
const productIngredientShape = {
    productId: z.number().int().positive(),
    ingredientId: z.number().int().positive(),
    grams: z.number().positive(),
    referenceNetWeightGrams: z.number().positive(),
    displayOrder: z.number().int().optional(),
}

export const createProductIngredientSchema = z.object(productIngredientShape)

export const productIngredientIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

// grams/referenceNetWeightGrams alimentan calculateQuote -- se recuperan como requeridos dentro del
// .partial() (convención del repo para campos del cálculo), así un PUT nunca los deja vacíos por omisión.
export const updateProductIngredientSchema = createProductIngredientSchema.partial().extend({
    grams: createProductIngredientSchema.shape.grams,
    referenceNetWeightGrams: createProductIngredientSchema.shape.referenceNetWeightGrams,
})

export type CreateProductIngredientInput = z.infer<typeof createProductIngredientSchema>
export type UpdateProductIngredientInput = z.infer<typeof updateProductIngredientSchema>
