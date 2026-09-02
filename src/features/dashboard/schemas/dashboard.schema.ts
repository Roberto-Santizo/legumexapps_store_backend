import { z } from "zod"

// Ambas fechas son opcionales: sin rango, el servicio trae el historico completo de cotizaciones.
// Se envian como "YYYY-MM-DD" desde el input type=date del front -- z.coerce.date() las parsea
export const dashboardSummaryQuerySchema = z
    .object({
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
    })
    .refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, {
        message: "startDate debe ser menor o igual a endDate",
        path: ["endDate"],
    })

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>
