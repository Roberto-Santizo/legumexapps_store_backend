import z from "zod"
import { businessDateSchema, isBusinessDateRangeOrdered } from "../../../shared/schemas/businessDate.schema"

export const adminQuoteListQuerySchema = z.object({
    startDate: businessDateSchema.optional(),
    endDate: businessDateSchema.optional(),
}).refine(isBusinessDateRangeOrdered, {
    message: "startDate debe ser menor o igual a endDate",
    path: ["endDate"],
})

export type AdminQuoteListQuery = z.infer<typeof adminQuoteListQuerySchema>
