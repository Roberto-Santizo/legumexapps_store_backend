import { z } from "zod"
import { businessDateSchema, isBusinessDateRangeOrdered } from "../../../shared/schemas/businessDate.schema"

// Rango opcional sobre la ÚLTIMA actividad del borrador (updatedAt) -- mismo formato que
// dashboardSummaryQuerySchema: días "YYYY-MM-DD" en hora de Guatemala.
export const listQuoteDraftsQuerySchema = z
    .object({
        startDate: businessDateSchema.optional(),
        endDate: businessDateSchema.optional(),
    })
    .refine(isBusinessDateRangeOrdered, {
        message: "startDate debe ser menor o igual a endDate",
        path: ["endDate"],
    })

export type ListQuoteDraftsQuery = z.infer<typeof listQuoteDraftsQuerySchema>
