import { createProductIngredientSchema, updateProductIngredientSchema } from "./productIngredient.schema"

describe("productIngredient schemas", () => {
    it.each([
        ["grams = 0", { grams: 0, referenceNetWeightGrams: 2000 }],
        ["grams negativo", { grams: -1, referenceNetWeightGrams: 2000 }],
        ["referencia = 0", { grams: 40, referenceNetWeightGrams: 0 }],
        ["referencia negativa", { grams: 40, referenceNetWeightGrams: -5 }],
    ])("create rechaza %s", (_label, values) => {
        const result = createProductIngredientSchema.safeParse({ productId: 1, ingredientId: 2, ...values })
        expect(result.success).toBe(false)
    })

    it("update sigue exigiendo grams y referenceNetWeightGrams (recuperados dentro del .partial())", () => {
        expect(updateProductIngredientSchema.safeParse({ displayOrder: 1 }).success).toBe(false)
        expect(updateProductIngredientSchema.safeParse({ grams: 40, referenceNetWeightGrams: 2000 }).success).toBe(true)
    })
})
