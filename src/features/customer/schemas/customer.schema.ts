import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

export const createCustomerSchema = z.object({
    name: z.string().trim().min(1).max(100),
    companyName: z.string().trim().max(100).optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(8),
})

export const customerIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateCustomerSchema = createCustomerSchema.partial()

// "search" busca por name o email -- ver customer.service.ts::listCustomers.
export const customerQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

// Body de PATCH /:id/status -- activar/desactivar el cliente (ver el mismo campo en
// user.schema.ts/category.schema.ts). Desactivar le corta el acceso al cotizador sin borrar su
// cuenta ni sus cotizaciones ya guardadas; activar se lo devuelve.
export const updateCustomerStatusSchema = z.object({
    isActive: z.boolean(),
})

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>
export type CustomerQuery = z.infer<typeof customerQuerySchema>
