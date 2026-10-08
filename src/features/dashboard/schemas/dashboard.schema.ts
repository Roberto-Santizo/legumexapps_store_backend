import { z } from "zod"
import { businessDateSchema, isBusinessDateRangeOrdered } from "../../../shared/schemas/businessDate.schema"

// Días calendario "YYYY-MM-DD" en hora de Guatemala, NO instantes: el servicio los convierte a
// límites de día locales (ver shared/schemas/businessDate.schema.ts).
export const dashboardSummaryQuerySchema = z
    .object({
        startDate: businessDateSchema.optional(),
        endDate: businessDateSchema.optional(),
    })
    .refine(isBusinessDateRangeOrdered, {
        message: "startDate debe ser menor o igual a endDate",
        path: ["endDate"],
    })

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>
