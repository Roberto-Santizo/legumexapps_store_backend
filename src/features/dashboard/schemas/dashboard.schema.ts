import { z } from "zod"


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
