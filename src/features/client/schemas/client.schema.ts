import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"


export const createClientSchema = z.object({
    name: z.string().trim().min(1).max(100),
})

export const clientIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateClientSchema = createClientSchema.partial()

export const updateClientStatusSchema = z.object({
    isActive: z.boolean(),
})

export const clientQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreateClientInput = z.infer<typeof createClientSchema>
export type UpdateClientInput = z.infer<typeof updateClientSchema>
export type ClientQuery = z.infer<typeof clientQuerySchema>
