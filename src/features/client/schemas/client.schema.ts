import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"


// Correo de un cliente (lo agrega el representante al enviar un pedido a revisión): sin espacios y en
// minúsculas, para comparar sin duplicados por formato.
export const clientEmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email())

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
