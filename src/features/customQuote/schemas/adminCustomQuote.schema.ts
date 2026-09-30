import z from "zod"
import { businessDateSchema, isBusinessDateRangeOrdered } from "../../../shared/schemas/businessDate.schema"
import { CUSTOM_QUOTE_STATUSES } from "../models/CustomQuote.model"

// Seguimiento admin de cotizaciones a la medida (/admin/custom-quotes). Rango opcional sobre la fecha
// en que se guardó (createdAt), en días "YYYY-MM-DD" de Guatemala -- mismo contrato que el dashboard y
// las cotizaciones sin finalizar (businessDayRangeFilter en el servicio).
export const listCustomQuotesQuerySchema = z
    .object({
        startDate: businessDateSchema.optional(),
        endDate: businessDateSchema.optional(),
        status: z.enum(CUSTOM_QUOTE_STATUSES).optional(),
    })
    .refine(isBusinessDateRangeOrdered, {
        message: "startDate debe ser menor o igual a endDate",
        path: ["endDate"],
    })

export const customQuoteIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateCustomQuoteStatusSchema = z.object({
    status: z.enum(CUSTOM_QUOTE_STATUSES),
})

export type ListCustomQuotesQuery = z.infer<typeof listCustomQuotesQuerySchema>
export type UpdateCustomQuoteStatusInput = z.infer<typeof updateCustomQuoteStatusSchema>
