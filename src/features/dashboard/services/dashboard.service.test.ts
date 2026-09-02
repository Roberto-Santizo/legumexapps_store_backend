import "reflect-metadata"

// Mock manual: dashboard.service.ts solo llama a Quote.findAll -- no hace falta una base de
// datos real. Cada "quote" de prueba es un objeto plano con exactamente la forma que el
// servicio lee (ver dashboard.service.ts), más un .get("createdAt") porque createdAt no es un
// campo declarado en Quote.model.ts (timestamp automático de Sequelize) y el servicio lo lee
// con quote.get("createdAt"), igual que quoteService.saveQuote ya hacía.
jest.mock("../../quote/models/Quote.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn() }
}))

import Quote from "../../quote/models/Quote.model"
import { dashboardService } from "./dashboard.service"

const mockQuoteFindAll = Quote.findAll as unknown as jest.Mock

interface StubQuoteInput {
    customerId: number
    totalCost: number
    requestedPallets: number
    totalUnits: number
    productDisplayName: string
    createdAt: string
    quotedVariant?: { id: number; parentProduct: { id: number } | null } | null
    quotingCustomer?: { id: number; name: string; companyName: string | null; email: string } | null
    breakdown?: { rawMaterials: { ingredientId: number; displayName: string; lineTotal: number }[] }
}

function stubQuote(overrides: Partial<StubQuoteInput> = {}) {
    const data: StubQuoteInput = {
        customerId: 1,
        totalCost: 100,
        requestedPallets: 1,
        totalUnits: 10,
        productDisplayName: "Piña IQF",
        createdAt: "2026-01-10T00:00:00.000Z",
        quotedVariant: { id: 50, parentProduct: { id: 5 } },
        quotingCustomer: { id: 1, name: "Cliente Uno", companyName: null, email: "uno@cliente.com" },
        breakdown: { rawMaterials: [] },
        ...overrides
    }
    return {
        ...data,
        get(key: string) {
            return (data as unknown as Record<string, unknown>)[key]
        }
    }
}

describe("dashboardService.getSummary", () => {
    beforeEach(() => {
        mockQuoteFindAll.mockReset()
    })

    it("devuelve todo en cero/vacío cuando no hay cotizaciones", async () => {
        mockQuoteFindAll.mockResolvedValue([])

        const summary = await dashboardService.getSummary()

        expect(summary.overview).toEqual({
            totalQuotes: 0,
            totalRevenue: 0,
            totalPallets: 0,
            totalUnits: 0,
            uniqueCustomers: 0,
            averageQuoteValue: 0
        })
        expect(summary.trend).toEqual([])
        expect(summary.topProducts).toEqual([])
        expect(summary.topCustomers).toEqual([])
        expect(summary.topIngredients).toEqual([])
    })

    it("suma overview a partir de todas las cotizaciones traídas", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({ customerId: 1, totalCost: 100, requestedPallets: 1, totalUnits: 10 }),
            stubQuote({ customerId: 2, totalCost: 300, requestedPallets: 3, totalUnits: 30 })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.overview).toEqual({
            totalQuotes: 2,
            totalRevenue: 400,
            totalPallets: 4,
            totalUnits: 40,
            uniqueCustomers: 2,
            averageQuoteValue: 200
        })
    })

    it("agrupa productos por el id real del producto, no por el nombre, y ordena por unidades", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({
                productDisplayName: "Piña IQF",
                totalUnits: 10,
                totalCost: 50,
                quotedVariant: { id: 50, parentProduct: { id: 5 } }
            }),
            // Mismo producto (id 5), nombre renombrado después -- debe quedar en una sola fila
            // con el nombre más reciente (las cotizaciones se procesan en orden ascendente).
            stubQuote({
                productDisplayName: "Piña IQF Premium",
                totalUnits: 5,
                totalCost: 25,
                createdAt: "2026-01-11T00:00:00.000Z",
                quotedVariant: { id: 50, parentProduct: { id: 5 } }
            }),
            stubQuote({
                productDisplayName: "Mango IQF",
                totalUnits: 100,
                totalCost: 500,
                quotedVariant: { id: 60, parentProduct: { id: 6 } }
            })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.topProducts).toEqual([
            expect.objectContaining({ productId: 6, productDisplayName: "Mango IQF", quoteCount: 1, totalUnits: 100 }),
            expect.objectContaining({ productId: 5, productDisplayName: "Piña IQF Premium", quoteCount: 2, totalUnits: 15 })
        ])
    })

    it("topProductsByRevenue usa el mismo agrupamiento que topProducts pero ordenado por ingresos", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({
                productDisplayName: "Piña IQF",
                totalUnits: 100,
                totalCost: 50,
                quotedVariant: { id: 50, parentProduct: { id: 5 } }
            }),
            stubQuote({
                productDisplayName: "Mango IQF",
                totalUnits: 10,
                totalCost: 500,
                quotedVariant: { id: 60, parentProduct: { id: 6 } }
            })
        ])

        const summary = await dashboardService.getSummary()

        // Por unidades, Piña gana; por ingresos, Mango gana -- confirma que son dos rankings
        // independientes sobre el mismo agrupamiento, no el mismo arreglo reordenado en el front.
        expect(summary.topProducts[0]).toMatchObject({ productId: 5, totalUnits: 100 })
        expect(summary.topProductsByRevenue[0]).toMatchObject({ productId: 6, totalRevenue: 500 })
    })

    it("agrupa clientes y ordena por valor total cotizado (no por cantidad de cotizaciones)", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({
                totalCost: 50,
                quotingCustomer: { id: 1, name: "Cliente Frecuente", companyName: null, email: "a@a.com" }
            }),
            stubQuote({
                totalCost: 50,
                quotingCustomer: { id: 1, name: "Cliente Frecuente", companyName: null, email: "a@a.com" }
            }),
            stubQuote({
                totalCost: 500,
                quotingCustomer: { id: 2, name: "Cliente Grande", companyName: "ACME", email: "b@b.com" }
            })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.topCustomers[0]).toMatchObject({ customerId: 2, name: "Cliente Grande", totalRevenue: 500, quoteCount: 1 })
        expect(summary.topCustomers[1]).toMatchObject({ customerId: 1, name: "Cliente Frecuente", totalRevenue: 100, quoteCount: 2 })
    })

    it("agrega ingredientes desde el snapshot congelado (breakdown.rawMaterials), sumando costo por ingrediente", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({
                breakdown: {
                    rawMaterials: [
                        { ingredientId: 1, displayName: "Piña", lineTotal: 40 },
                        { ingredientId: 2, displayName: "Mango", lineTotal: 10 }
                    ]
                }
            }),
            stubQuote({
                breakdown: { rawMaterials: [{ ingredientId: 1, displayName: "Piña", lineTotal: 60 }] }
            })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.topIngredients).toEqual([
            expect.objectContaining({ ingredientId: 1, displayName: "Piña", totalCost: 100, quoteCount: 2 }),
            expect.objectContaining({ ingredientId: 2, displayName: "Mango", totalCost: 10, quoteCount: 1 })
        ])
    })

    it("suma dinero sin arrastrar ruido de floats nativos (bug real: 0.1 + 0.2 + 0.0001 da 0.30010000000000003 con `+` nativo)", async () => {
        // Reproduce con datos reales de dashboard el mismo caso que money.util.test.ts prueba de
        // forma aislada. dashboard.service.ts NO pasa por money.util.ts (a diferencia de
        // quote.service.ts) -- suma con `Number(...) + ` nativo en varios lugares
        // (buildOverview, buildTrend, groupProductsByRealId, buildTopCustomers,
        // buildTopIngredients). Con montos de dinero reales esto puede filtrar un float sin
        // redondear (ej. 0.30010000000000003) directo en el JSON de /admin/dashboard/summary,
        // en vez del monto exacto.
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({
                customerId: 1,
                totalCost: 0.1,
                quotingCustomer: { id: 1, name: "Cliente A", companyName: null, email: "a@a.com" },
                quotedVariant: { id: 50, parentProduct: { id: 5 } },
                breakdown: { rawMaterials: [{ ingredientId: 1, displayName: "Piña", lineTotal: 0.1 }] }
            }),
            stubQuote({
                customerId: 1,
                totalCost: 0.2,
                quotingCustomer: { id: 1, name: "Cliente A", companyName: null, email: "a@a.com" },
                quotedVariant: { id: 50, parentProduct: { id: 5 } },
                breakdown: { rawMaterials: [{ ingredientId: 1, displayName: "Piña", lineTotal: 0.2 }] }
            }),
            stubQuote({
                customerId: 1,
                totalCost: 0.0001,
                quotingCustomer: { id: 1, name: "Cliente A", companyName: null, email: "a@a.com" },
                quotedVariant: { id: 50, parentProduct: { id: 5 } },
                breakdown: { rawMaterials: [{ ingredientId: 1, displayName: "Piña", lineTotal: 0.0001 }] }
            })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.overview.totalRevenue).toBe(0.3001)
        expect(summary.topProducts[0].totalRevenue).toBe(0.3001)
        expect(summary.topProductsByRevenue[0].totalRevenue).toBe(0.3001)
        expect(summary.topCustomers[0].totalRevenue).toBe(0.3001)
        expect(summary.topIngredients[0].totalCost).toBe(0.3001)
    })

    it("agrupa la tendencia por día cuando el rango es corto", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({ createdAt: "2026-01-10T08:00:00.000Z", totalCost: 100 }),
            stubQuote({ createdAt: "2026-01-10T20:00:00.000Z", totalCost: 50 }),
            stubQuote({ createdAt: "2026-01-11T08:00:00.000Z", totalCost: 25 })
        ])

        const summary = await dashboardService.getSummary(new Date("2026-01-10"), new Date("2026-01-11"))

        expect(summary.trendGranularity).toBe("day")
        expect(summary.trend).toEqual([
            { bucketStart: "2026-01-10", count: 2, revenue: 150 },
            { bucketStart: "2026-01-11", count: 1, revenue: 25 }
        ])
    })

    it("cambia la tendencia a semanal cuando el rango supera el umbral de buckets diarios", async () => {
        mockQuoteFindAll.mockResolvedValue([stubQuote({ createdAt: "2026-01-10T00:00:00.000Z" })])

        const summary = await dashboardService.getSummary(new Date("2026-01-01"), new Date("2026-06-01"))

        expect(summary.trendGranularity).toBe("week")
    })
})
