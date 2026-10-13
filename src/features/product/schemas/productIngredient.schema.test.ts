import { createProductIngredientSchema, updateProductIngredientSchema } from "./productIngredient.schema"

describe("productIngredient schemas", () => {
    it.each([0.001, 0.01, 0.25, 0.5, 9999999.999])("preserves valid grams %s on create and update", grams => {
        const input = { productId: 1, ingredientId: 2, grams, referenceNetWeightGrams: 99999999.99 }
        expect(createProductIngredientSchema.parse(input)).toEqual(input)
        expect(updateProductIngredientSchema.parse(input)).toEqual(input)
    })
    it.each([
        { grams: 0.0001, referenceNetWeightGrams: 1000 },
        { grams: 1.2345, referenceNetWeightGrams: 1000 },
        { grams: 10000000, referenceNetWeightGrams: 1000 },
        { grams: 1, referenceNetWeightGrams: 0.001 },
        { grams: 1, referenceNetWeightGrams: 1000.001 },
        { grams: 1, referenceNetWeightGrams: 100000000 },
        { grams: Infinity, referenceNetWeightGrams: 1000 },
        { grams: 0, referenceNetWeightGrams: 1000 },
        { grams: -1, referenceNetWeightGrams: 1000 },
        { grams: 1, referenceNetWeightGrams: 0 },
    ])("rejects quantities outside DECIMAL precision: %j", values => {
        const input = { productId: 1, ingredientId: 2, ...values }
        expect(createProductIngredientSchema.safeParse(input).success).toBe(false)
        expect(updateProductIngredientSchema.safeParse(input).success).toBe(false)
    })
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

    it("preserves decimal reference weights on create and update", () => {
        const input = { productId: 1, ingredientId: 2, grams: 0.001, referenceNetWeightGrams: 1000.01 }
        expect(createProductIngredientSchema.parse(input)).toEqual(input)
        expect(updateProductIngredientSchema.parse(input)).toEqual(input)
    })
})
