import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

export const createPresentationSchema = z.object({
    displayLabel: z.string().trim().min(1).max(40),
    netVolumeMl: z.number().positive().max(99999999999.999).multipleOf(0.001).nullable().optional(),
    netWeightGrams: z.number().positive(),
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
