import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

export const createPresentationSchema = z.object({
    displayLabel: z.string().trim().min(1).max(40),
    netWeightGrams: z.number().positive(),
    categoryId: z.number().int().positive().optional(),
})

export const presentationIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})


export const updatePresentationSchema = createPresentationSchema.partial().extend({
    netWeightGrams: createPresentationSchema.shape.netWeightGrams,
})

export const presentationQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreatePresentationInput = z.infer<typeof createPresentationSchema>
export type UpdatePresentationInput = z.infer<typeof updatePresentationSchema>
export type PresentationQuery = z.infer<typeof presentationQuerySchema>
