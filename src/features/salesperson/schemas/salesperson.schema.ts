import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"
import { representativeClientIdsSchema } from "./representativeClient.schema"

const salespersonFieldsSchema = z.object({
    name: z.string().trim().min(1).max(100),
    companyName: z.string().trim().max(100).optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(8),
})

// Optional clients assigned in the same transaction as the creation: a list or all active ones, never both.
export const createSalespersonSchema = salespersonFieldsSchema.extend({
    clientIds: representativeClientIdsSchema.optional(),
    assignAllClients: z.boolean().optional(),
}).refine(input => !(input.assignAllClients && input.clientIds), { path: ["clientIds"] })

// Read after validation, so the body already has the parsed shape.
export const hasInitialClients = (req: { body: CreateSalespersonInput }) => Boolean(req.body.clientIds || req.body.assignAllClients)

export const salespersonIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateSalespersonSchema = salespersonFieldsSchema.partial()

export const salespersonQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})


export const updateSalespersonStatusSchema = z.object({
    isActive: z.boolean(),
})

export type CreateSalespersonInput = z.infer<typeof createSalespersonSchema>
export type UpdateSalespersonInput = z.infer<typeof updateSalespersonSchema>
export type SalespersonQuery = z.infer<typeof salespersonQuerySchema>
