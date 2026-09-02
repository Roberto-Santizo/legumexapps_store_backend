import { z } from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

const imageInputSchema = z.string()

const categoryTranslationInputSchema = z.object({
    displayName: z.string().trim().min(1).max(80).optional(),
    fullDescription: z.string().trim().nullable().optional(),
})

export const createCategorySchema = z.object({
    displayName: z.string().trim().min(1).max(80),
    fullDescription: z.string().trim().optional(),
    image: imageInputSchema,
    translations: z.object({ en: categoryTranslationInputSchema.optional() }).optional(),
})

export const updateCategorySchema = createCategorySchema.partial()

export const categoryIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const categoryQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export const updateCategoryStatusSchema = z.object({
    isActive: z.boolean(),
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
export type CategoryTranslationInput = z.infer<typeof categoryTranslationInputSchema>
export type CategoryQuery = z.infer<typeof categoryQuerySchema>
