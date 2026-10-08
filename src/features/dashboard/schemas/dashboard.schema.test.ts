import { dashboardSummaryQuerySchema } from "./dashboard.schema"

describe("dashboardSummaryQuerySchema", () => {
    it("acepta días YYYY-MM-DD y los deja como string (el servicio aplica la hora de Guatemala)", () => {
        const result = dashboardSummaryQuerySchema.parse({ startDate: "2026-01-10", endDate: "2026-01-11" })
        expect(result).toEqual({ startDate: "2026-01-10", endDate: "2026-01-11" })
    })

    it("acepta rango vacío o con un solo extremo", () => {
        expect(dashboardSummaryQuerySchema.parse({})).toEqual({})
        expect(dashboardSummaryQuerySchema.parse({ endDate: "2026-01-11" })).toEqual({ endDate: "2026-01-11" })
    })

    it("rechaza fechas inexistentes, instantes ISO completos y startDate > endDate", () => {
        expect(dashboardSummaryQuerySchema.safeParse({ startDate: "2026-02-30" }).success).toBe(false)
        expect(dashboardSummaryQuerySchema.safeParse({ startDate: "2026-01-10T00:00:00Z" }).success).toBe(false)
        expect(dashboardSummaryQuerySchema.safeParse({ startDate: "2026-01-12", endDate: "2026-01-11" }).success).toBe(false)
    })
})
