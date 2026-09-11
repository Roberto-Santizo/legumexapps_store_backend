import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

const ingredientTranslationInputSchema = z.object({
    displayName: z.string().trim().min(1).max(120).optional(),
})

export const createIngredientSchema = z.object({
    code: z.string().trim().min(1).max(60),
    displayName: z.string().trim().min(1).max(120),
    ingredientType: z.enum(["fruit", "vegetable", "pulp", "other"]),
    isOrganic: z.boolean().optional(),
    isMixable: z.boolean().optional(),
    costPerUnit: z.number().nonnegative(),
    costUnitId: z.number().int().positive(),
    translations: z.object({ en: ingredientTranslationInputSchema.optional() }).optional(),
})

export const ingredientIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateIngredientSchema = createIngredientSchema.partial().extend({
    code: createIngredientSchema.shape.code,
    costPerUnit: createIngredientSchema.shape.costPerUnit,
    costUnitId: createIngredientSchema.shape.costUnitId,
})

export const ingredientQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreateIngredientInput = z.infer<typeof createIngredientSchema>
export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>
export type IngredientTranslationInput = z.infer<typeof ingredientTranslationInputSchema>
export type IngredientQuery = z.infer<typeof ingredientQuerySchema>
