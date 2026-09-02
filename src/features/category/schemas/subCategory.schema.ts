import { z } from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

const subCategoryTranslationInputSchema = z.object({
    displayName: z.string().trim().min(1).max(80).optional(),
    fullDescription: z.string().trim().nullable().optional(),
})

export const createSubCategorySchema = z.object({
    categoryId: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(80),
    fullDescription: z.string().trim().optional(),
    translations: z.object({ en: subCategoryTranslationInputSchema.optional() }).optional(),
})

export const updateSubCategorySchema = createSubCategorySchema.partial()

export const subCategoryIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateSubCategoryStatusSchema = z.object({
    isActive: z.boolean(),
})

export const subCategoryQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreateSubCategoryInput = z.infer<typeof createSubCategorySchema>
export type UpdateSubCategoryInput = z.infer<typeof updateSubCategorySchema>
export type SubCategoryTranslationInput = z.infer<typeof subCategoryTranslationInputSchema>
export type SubCategoryQuery = z.infer<typeof subCategoryQuerySchema>
