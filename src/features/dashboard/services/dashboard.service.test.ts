import "reflect-metadata"
import { Op } from "sequelize"

// Mock manual: dashboard.service.ts solo llama a Quote.findAll -- no hace falta una base de
// datos real. Cada "quote" de prueba es un objeto plano con exactamente la forma que el
// servicio lee (ver dashboard.service.ts), más un .get("createdAt") porque createdAt no es un
// campo declarado en Quote.model.ts (timestamp automático de Sequelize) y el servicio lo lee
// con quote.get("createdAt"), igual que quoteService.saveQuote ya hacía.
jest.mock("../../quote/models/Quote.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn() }
}))
// Borradores (cotizaciones sin finalizar) viven en su propia tabla y NUNCA alimentan el dashboard --
// se mockea solo para poder afirmar que getSummary jamás los consulta.
jest.mock("../../quoteDraft/models/QuoteDraft.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn(), findOne: jest.fn(), count: jest.fn() }
}))

// Catálogo vivo para los nombres de los rankings (productos y materias primas). Por defecto no
// devuelven filas, así el nombre cae al del snapshot (el comportamiento de respaldo).
jest.mock("../../product/models/Product.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn() }
}))
jest.mock("../../rawMaterial/models/RawMaterial.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn() }
}))

// Cotizaciones a la medida (productos que no existen, sin SKU) viven en su propia tabla y NUNCA
// alimentan el dashboard -- se mockea solo para afirmar que getSummary jamás la consulta.
jest.mock("../../customQuote/models/CustomQuote.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn(), findOne: jest.fn(), count: jest.fn() }
}))

import Quote from "../../quote/models/Quote.model"
import Product from "../../product/models/Product.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import QuoteDraft from "../../quoteDraft/models/QuoteDraft.model"
import CustomQuote from "../../customQuote/models/CustomQuote.model"
import { dashboardService } from "./dashboard.service"

const mockQuoteFindAll = Quote.findAll as unknown as jest.Mock
const mockProductFindAll = Product.findAll as unknown as jest.Mock
const mockRawMaterialFindAll = RawMaterial.findAll as unknown as jest.Mock

interface StubQuoteInput {
    salespersonId: number
    totalCost: number
    requestedPallets: number
    totalUnits: number
    productDisplayName: string
    createdAt: string
    quotedVariant?: { id: number; parentProduct: { id: number } | null } | null
    quotingSalesperson?: { id: number; name: string; companyName: string | null; email: string } | null
    breakdown?: { rawMaterials: { rawMaterialId: number; displayName: string; lineTotal: number }[] }
}

function stubQuote(overrides: Partial<StubQuoteInput> = {}) {
    const data: StubQuoteInput = {
        salespersonId: 1,
        totalCost: 100,
        requestedPallets: 1,
        totalUnits: 10,
        productDisplayName: "Piña IQF",
        createdAt: "2026-01-10T00:00:00.000Z",
        quotedVariant: { id: 50, parentProduct: { id: 5 } },
        quotingSalesperson: { id: 1, name: "Representante Uno", companyName: null, email: "uno@legumex.com" },
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
        mockProductFindAll.mockReset().mockResolvedValue([])
        mockRawMaterialFindAll.mockReset().mockResolvedValue([])
    })

    it("devuelve todo en cero/vacío cuando no hay cotizaciones", async () => {
        mockQuoteFindAll.mockResolvedValue([])

        const summary = await dashboardService.getSummary()

        expect(summary.overview).toEqual({
            totalQuotes: 0,
            totalRevenue: 0,
            totalPallets: 0,
            totalUnits: 0,
            uniqueSalespeople: 0,
            averageQuoteValue: 0
        })
        expect(summary.trend).toEqual([])
        expect(summary.topProducts).toEqual([])
        expect(summary.topSalespeople).toEqual([])
        expect(summary.topRawMaterials).toEqual([])
    })

    it("suma overview a partir de todas las cotizaciones traídas", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({ salespersonId: 1, totalCost: 100, requestedPallets: 1, totalUnits: 10 }),
            stubQuote({ salespersonId: 2, totalCost: 300, requestedPallets: 3, totalUnits: 30 })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.overview).toEqual({
            totalQuotes: 2,
            totalRevenue: 400,
            totalPallets: 4,
            totalUnits: 40,
            uniqueSalespeople: 2,
            averageQuoteValue: 200
        })
    })

    it("agrupa productos por el id real del producto, no por el nombre (respaldo: nombre del snapshot más reciente)", async () => {
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

    it("ordena top productos por valor cotizado, no por unidades sumadas (presentaciones de distinto tamaño)", async () => {
        mockQuoteFindAll.mockResolvedValue([
            // 720 bolsas de 500 g: más unidades, menos valor.
            stubQuote({
                productDisplayName: "Piña IQF",
                totalUnits: 720,
                totalCost: 50,
                quotedVariant: { id: 50, parentProduct: { id: 5 } }
            }),
            // 400 bolsas de 2 kg: menos unidades, más valor.
            stubQuote({
                productDisplayName: "Mango IQF",
                totalUnits: 400,
                totalCost: 500,
                quotedVariant: { id: 60, parentProduct: { id: 6 } }
            })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.topProducts.map(product => product.productId)).toEqual([6, 5])
        expect(summary.topProducts[0]).toMatchObject({ totalRevenue: 500, totalUnits: 400 })
        expect(summary).not.toHaveProperty("topProductsByRevenue")
    })

    describe("nombres vivos del catálogo (no el snapshot)", () => {
        const quotes = () => [
            stubQuote({
                productDisplayName: "Pineapple chunks",
                totalCost: 300,
                quotedVariant: { id: 50, parentProduct: { id: 5 } },
                breakdown: { rawMaterials: [{ rawMaterialId: 1, displayName: "Pineapple", lineTotal: 40 }] }
            }),
            stubQuote({
                productDisplayName: "Mango IQF",
                totalCost: 100,
                quotedVariant: { id: 60, parentProduct: { id: 6 } },
                breakdown: { rawMaterials: [{ rawMaterialId: 2, displayName: "Mango", lineTotal: 10 }] }
            })
        ]
        const liveProducts = [
            { id: 5, displayName: "Trozos de piña", translations: [{ language: "en", displayName: "Pineapple pieces" }] },
            { id: 6, displayName: "Mango IQF", translations: [] }
        ]
        const liveRawMaterials = [
            { id: 1, displayName: "Piña", translations: [{ language: "en", displayName: "Pineapple (live)" }] },
            { id: 2, displayName: "Mango", translations: [] }
        ]

        it("en español usa Product.displayName / RawMaterial.displayName aunque el snapshot esté en inglés", async () => {
            mockQuoteFindAll.mockResolvedValue(quotes())
            mockProductFindAll.mockResolvedValue(liveProducts)
            mockRawMaterialFindAll.mockResolvedValue(liveRawMaterials)

            const summary = await dashboardService.getSummary(undefined, undefined, "es")

            expect(summary.topProducts.map(product => product.productDisplayName)).toEqual(["Trozos de piña", "Mango IQF"])
            expect(summary.topRawMaterials.map(rawMaterial => rawMaterial.displayName)).toEqual(["Piña", "Mango"])
        })

        it("en inglés usa la traducción, y cae al nombre base si no hay traducción", async () => {
            mockQuoteFindAll.mockResolvedValue(quotes())
            mockProductFindAll.mockResolvedValue(liveProducts)
            mockRawMaterialFindAll.mockResolvedValue(liveRawMaterials)

            const summary = await dashboardService.getSummary(undefined, undefined, "en")

            expect(summary.topProducts.map(product => product.productDisplayName)).toEqual(["Pineapple pieces", "Mango IQF"])
            expect(summary.topRawMaterials.map(rawMaterial => rawMaterial.displayName)).toEqual(["Pineapple (live)", "Mango"])
        })

        it("si el producto / la materia prima ya no existe, queda el nombre del snapshot", async () => {
            mockQuoteFindAll.mockResolvedValue(quotes())
            mockProductFindAll.mockResolvedValue([liveProducts[1]])
            mockRawMaterialFindAll.mockResolvedValue([liveRawMaterials[1]])

            const summary = await dashboardService.getSummary()

            expect(summary.topProducts[0].productDisplayName).toBe("Pineapple chunks")
            expect(summary.topRawMaterials[0].displayName).toBe("Pineapple")
        })

        it("consulta solo los ids del ranking, sin filtrar por isActive", async () => {
            mockQuoteFindAll.mockResolvedValue(quotes())

            await dashboardService.getSummary()

            const productWhere = mockProductFindAll.mock.calls[0][0].where
            expect(productWhere.id[Op.in]).toEqual([5, 6])
            expect(productWhere).not.toHaveProperty("isActive")
            expect(mockRawMaterialFindAll.mock.calls[0][0].where.id[Op.in]).toEqual([1, 2])
        })

        it("sin cotizaciones no consulta el catálogo", async () => {
            mockQuoteFindAll.mockResolvedValue([])

            await dashboardService.getSummary()

            expect(mockProductFindAll).not.toHaveBeenCalled()
            expect(mockRawMaterialFindAll).not.toHaveBeenCalled()
        })

        it("solo cambia nombres: montos, conteos y orden idénticos con o sin catálogo vivo", async () => {
            mockQuoteFindAll.mockResolvedValue(quotes())
            const fallback = await dashboardService.getSummary()

            mockProductFindAll.mockResolvedValue(liveProducts)
            mockRawMaterialFindAll.mockResolvedValue(liveRawMaterials)
            const live = await dashboardService.getSummary()

            const withoutNames = <T extends object>(rows: T[], nameKey: keyof T) =>
                rows.map(row => ({ ...row, [nameKey]: undefined }))
            expect(withoutNames(live.topProducts, "productDisplayName")).toEqual(withoutNames(fallback.topProducts, "productDisplayName"))
            expect(withoutNames(live.topRawMaterials, "displayName")).toEqual(withoutNames(fallback.topRawMaterials, "displayName"))
            expect(live.overview).toEqual(fallback.overview)
            expect(live.trend).toEqual(fallback.trend)
            expect(live.topSalespeople).toEqual(fallback.topSalespeople)
        })
    })

    it("agrupa clientes y ordena por valor total cotizado (no por cantidad de cotizaciones)", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({
                totalCost: 50,
                quotingSalesperson: { id: 1, name: "Cliente Frecuente", companyName: null, email: "a@a.com" }
            }),
            stubQuote({
                totalCost: 50,
                quotingSalesperson: { id: 1, name: "Cliente Frecuente", companyName: null, email: "a@a.com" }
            }),
            stubQuote({
                totalCost: 500,
                quotingSalesperson: { id: 2, name: "Cliente Grande", companyName: "ACME", email: "b@b.com" }
            })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.topSalespeople[0]).toMatchObject({ salespersonId: 2, name: "Cliente Grande", totalRevenue: 500, quoteCount: 1 })
        expect(summary.topSalespeople[1]).toMatchObject({ salespersonId: 1, name: "Cliente Frecuente", totalRevenue: 100, quoteCount: 2 })
    })

    it("agrega materias primas desde el snapshot congelado (breakdown.rawMaterials), sumando costo por materia prima", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({
                breakdown: {
                    rawMaterials: [
                        { rawMaterialId: 1, displayName: "Piña", lineTotal: 40 },
                        { rawMaterialId: 2, displayName: "Mango", lineTotal: 10 }
                    ]
                }
            }),
            stubQuote({
                breakdown: { rawMaterials: [{ rawMaterialId: 1, displayName: "Piña", lineTotal: 60 }] }
            })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.topRawMaterials).toEqual([
            expect.objectContaining({ rawMaterialId: 1, displayName: "Piña", totalCost: 100, quoteCount: 2 }),
            expect.objectContaining({ rawMaterialId: 2, displayName: "Mango", totalCost: 10, quoteCount: 1 })
        ])
    })

    it("suma dinero sin arrastrar ruido de floats nativos (bug real: 0.1 + 0.2 + 0.0001 da 0.30010000000000003 con `+` nativo)", async () => {
        // Reproduce con datos reales de dashboard el mismo caso que money.util.test.ts prueba de
        // forma aislada. dashboard.service.ts NO pasa por money.util.ts (a diferencia de
        // quote.service.ts) -- suma con `Number(...) + ` nativo en varios lugares
        // (buildOverview, buildTrend, groupProductsByRealId, buildTopSalespeople,
        // buildTopRawMaterials). Con montos de dinero reales esto puede filtrar un float sin
        // redondear (ej. 0.30010000000000003) directo en el JSON de /admin/dashboard/summary,
        // en vez del monto exacto.
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({
                salespersonId: 1,
                totalCost: 0.1,
                quotingSalesperson: { id: 1, name: "Cliente A", companyName: null, email: "a@a.com" },
                quotedVariant: { id: 50, parentProduct: { id: 5 } },
                breakdown: { rawMaterials: [{ rawMaterialId: 1, displayName: "Piña", lineTotal: 0.1 }] }
            }),
            stubQuote({
                salespersonId: 1,
                totalCost: 0.2,
                quotingSalesperson: { id: 1, name: "Cliente A", companyName: null, email: "a@a.com" },
                quotedVariant: { id: 50, parentProduct: { id: 5 } },
                breakdown: { rawMaterials: [{ rawMaterialId: 1, displayName: "Piña", lineTotal: 0.2 }] }
            }),
            stubQuote({
                salespersonId: 1,
                totalCost: 0.0001,
                quotingSalesperson: { id: 1, name: "Cliente A", companyName: null, email: "a@a.com" },
                quotedVariant: { id: 50, parentProduct: { id: 5 } },
                breakdown: { rawMaterials: [{ rawMaterialId: 1, displayName: "Piña", lineTotal: 0.0001 }] }
            })
        ])

        const summary = await dashboardService.getSummary()

        expect(summary.overview.totalRevenue).toBe(0.3001)
        expect(summary.topProducts[0].totalRevenue).toBe(0.3001)
        expect(summary.topSalespeople[0].totalRevenue).toBe(0.3001)
        expect(summary.topRawMaterials[0].totalCost).toBe(0.3001)
    })

    it("agrupa la tendencia por día cuando el rango es corto", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({ createdAt: "2026-01-10T08:00:00.000Z", totalCost: 100 }),
            stubQuote({ createdAt: "2026-01-10T20:00:00.000Z", totalCost: 50 }),
            stubQuote({ createdAt: "2026-01-11T08:00:00.000Z", totalCost: 25 })
        ])

        const summary = await dashboardService.getSummary("2026-01-10", "2026-01-11")

        expect(summary.trendGranularity).toBe("day")
        expect(summary.trend).toEqual([
            { bucketStart: "2026-01-10", count: 2, revenue: 150 },
            { bucketStart: "2026-01-11", count: 1, revenue: 25 }
        ])
    })

    it("cambia la tendencia a semanal cuando el rango supera el umbral de buckets diarios", async () => {
        mockQuoteFindAll.mockResolvedValue([stubQuote({ createdAt: "2026-01-10T00:00:00.000Z" })])

        const summary = await dashboardService.getSummary("2026-01-01", "2026-06-01")

        expect(summary.trendGranularity).toBe("week")
    })

    it("la tendencia agrupa por día de Guatemala: una cotización a las 20:00 locales no cae en el día UTC siguiente", async () => {
        mockQuoteFindAll.mockResolvedValue([
            // 2026-01-10 09:00 local
            stubQuote({ createdAt: "2026-01-10T15:00:00.000Z", totalCost: 100 }),
            // 2026-01-10 20:00 local (= 2026-01-11 02:00 UTC)
            stubQuote({ createdAt: "2026-01-11T02:00:00.000Z", totalCost: 50 })
        ])

        const summary = await dashboardService.getSummary("2026-01-10", "2026-01-10")

        expect(summary.trend).toEqual([{ bucketStart: "2026-01-10", count: 2, revenue: 150 }])
    })

    it("la tendencia semanal usa el lunes local como inicio del bucket", async () => {
        mockQuoteFindAll.mockResolvedValue([
            // Domingo 2026-01-11 21:00 local (= lunes 03:00 UTC) → semana del lunes 2026-01-05
            stubQuote({ createdAt: "2026-01-12T03:00:00.000Z", totalCost: 10 }),
            // Lunes 2026-01-12 08:00 local → semana del lunes 2026-01-12
            stubQuote({ createdAt: "2026-01-12T14:00:00.000Z", totalCost: 20 })
        ])

        const summary = await dashboardService.getSummary("2026-01-01", "2026-06-01")

        expect(summary.trendGranularity).toBe("week")
        expect(summary.trend).toEqual([
            { bucketStart: "2026-01-05", count: 1, revenue: 10 },
            { bucketStart: "2026-01-12", count: 1, revenue: 20 }
        ])
    })

    it("la tendencia usa el mismo conjunto filtrado que el resto del resumen", async () => {
        mockQuoteFindAll.mockResolvedValue([
            stubQuote({ createdAt: "2026-01-10T15:00:00.000Z", totalCost: 100 }),
            stubQuote({ createdAt: "2026-01-11T15:00:00.000Z", totalCost: 50 })
        ])

        const summary = await dashboardService.getSummary("2026-01-10", "2026-01-11")

        const trendCount = summary.trend.reduce((sum, point) => sum + point.count, 0)
        const trendRevenue = summary.trend.reduce((sum, point) => sum + point.revenue, 0)
        expect(trendCount).toBe(summary.overview.totalQuotes)
        expect(trendRevenue).toBe(summary.overview.totalRevenue)
    })

    // El bug que dejó pasar el rango sin aplicar: ningún test miraba el `where` que llega a findAll.
    describe("filtro de fechas enviado a Quote.findAll (límites de día en hora de Guatemala)", () => {
        beforeEach(() => {
            mockQuoteFindAll.mockResolvedValue([])
        })

        function sentWhere() {
            return mockQuoteFindAll.mock.calls[0][0].where
        }

        it("sin rango → where sin createdAt", async () => {
            await dashboardService.getSummary()

            expect(sentWhere()).toEqual({})
            expect(sentWhere()).not.toHaveProperty("createdAt")
        })

        it("solo inicio → createdAt >= 00:00 local del día (06:00 UTC), sin límite superior", async () => {
            await dashboardService.getSummary("2026-01-10")

            const createdAt = sentWhere().createdAt
            expect(createdAt[Op.gte]).toEqual(new Date("2026-01-10T06:00:00.000Z"))
            expect(createdAt[Op.lte]).toBeUndefined()
        })

        it("solo fin → createdAt <= 23:59:59.999 local del día, sin límite inferior", async () => {
            await dashboardService.getSummary(undefined, "2026-01-11")

            const createdAt = sentWhere().createdAt
            expect(createdAt[Op.lte]).toEqual(new Date("2026-01-12T05:59:59.999Z"))
            expect(createdAt[Op.gte]).toBeUndefined()
        })

        it("ambos → createdAt entre el inicio y el fin del rango local", async () => {
            await dashboardService.getSummary("2026-01-10", "2026-01-11")

            const createdAt = sentWhere().createdAt
            expect(createdAt[Op.gte]).toEqual(new Date("2026-01-10T06:00:00.000Z"))
            expect(createdAt[Op.lte]).toEqual(new Date("2026-01-12T05:59:59.999Z"))
        })

        it("devuelve el rango pedido tal cual (días locales)", async () => {
            const summary = await dashboardService.getSummary("2026-01-10", "2026-01-11")

            expect(summary.range).toEqual({ startDate: "2026-01-10", endDate: "2026-01-11" })
        })
    })

    describe("aislamiento de borradores (cotizaciones sin finalizar)", () => {
        const mockDraftFindAll = QuoteDraft.findAll as unknown as jest.Mock
        const quotes = [
            stubQuote({ salespersonId: 1, totalCost: 100 }),
            stubQuote({ salespersonId: 2, totalCost: 300, createdAt: "2026-01-11T00:00:00.000Z" })
        ]

        it("nunca consulta QuoteDraft", async () => {
            mockQuoteFindAll.mockResolvedValue(quotes)

            await dashboardService.getSummary()

            expect(QuoteDraft.findAll).not.toHaveBeenCalled()
            expect(QuoteDraft.findOne).not.toHaveBeenCalled()
            expect(QuoteDraft.count).not.toHaveBeenCalled()
        })

        it("el resumen es idéntico haya o no borradores en su tabla", async () => {
            mockQuoteFindAll.mockResolvedValue(quotes)
            mockDraftFindAll.mockResolvedValue([])
            const withoutDrafts = await dashboardService.getSummary()

            mockDraftFindAll.mockResolvedValue([
                { id: 1, salespersonId: 3, totalCost: 99999, requestedPallets: 50, status: "in_progress" },
                { id: 2, salespersonId: 1, totalCost: 5000, requestedPallets: 10, status: "converted" }
            ])
            const withDrafts = await dashboardService.getSummary()

            expect(withDrafts).toEqual(withoutDrafts)
            expect(withDrafts.overview.totalQuotes).toBe(2)
        })
    })

    describe("aislamiento de cotizaciones a la medida", () => {
        it("nunca consulta customQuotes: el resumen solo mide cotizaciones de productos definidos", async () => {
            mockQuoteFindAll.mockResolvedValue([stubQuote({ totalCost: 100 })])

            const summary = await dashboardService.getSummary()

            expect(CustomQuote.findAll).not.toHaveBeenCalled()
            expect(CustomQuote.findOne).not.toHaveBeenCalled()
            expect(CustomQuote.count).not.toHaveBeenCalled()
            expect(summary.overview.totalQuotes).toBe(1)
        })
    })
})
