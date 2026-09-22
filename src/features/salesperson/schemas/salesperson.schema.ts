import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

export const createSalespersonSchema = z.object({
    name: z.string().trim().min(1).max(100),
    companyName: z.string().trim().max(100).optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(8),
})

export const salespersonIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateSalespersonSchema = createSalespersonSchema.partial()

export const salespersonQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})


export const updateSalespersonStatusSchema = z.object({
    isActive: z.boolean(),
})

export type CreateSalespersonInput = z.infer<typeof createSalespersonSchema>
export type UpdateSalespersonInput = z.infer<typeof updateSalespersonSchema>
export type SalespersonQuery = z.infer<typeof salespersonQuerySchema>
