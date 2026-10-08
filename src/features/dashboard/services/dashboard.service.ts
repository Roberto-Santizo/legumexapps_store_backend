import { Op } from "sequelize"
import Decimal from "decimal.js"
import Quote from "../../quote/models/Quote.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import ProductVariant from "../../product/models/ProductVariant.model"
import Product from "../../product/models/Product.model"
import ProductTranslation from "../../product/models/ProductTranslation.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../../rawMaterial/models/RawMaterialTranslation.model"
import { toDecimal, roundMoney, sumMoney } from "../../../shared/utils/money.util"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE, pickTranslatedName } from "../../../shared/utils/translation.util"
import {
    businessDayKey,
    businessDayRangeFilter,
    businessWeekKey,
    inclusiveDaySpan,
} from "../../../shared/utils/businessTime.util"

const MAX_DAILY_BUCKETS = 62
const TOP_LIST_LIMIT = 8
interface RawMaterialSnapshotLine {
    rawMaterialId: number
    displayName: string
    lineTotal: number
}
interface QuoteBreakdownSnapshot {
    rawMaterials?: RawMaterialSnapshotLine[]
}

interface DashboardOverview {
    totalQuotes: number
    totalRevenue: number
    totalPallets: number
    totalUnits: number
    uniqueSalespeople: number
    averageQuoteValue: number
}

interface DashboardTrendPoint {
    bucketStart: string
    count: number
    revenue: number
}

interface DashboardTopProduct {
    productId: number | null
    productDisplayName: string
    quoteCount: number
    totalUnits: number
    totalPallets: number
    totalRevenue: number
}

interface DashboardTopSalesperson {
    salespersonId: number
    name: string
    companyName: string | null
    email: string
    quoteCount: number
    totalPallets: number
    totalRevenue: number
}

interface DashboardTopRawMaterial {
    rawMaterialId: number
    displayName: string
    quoteCount: number
    totalCost: number
}

interface DashboardSummary {
    // Días "YYYY-MM-DD" en hora de Guatemala, tal como llegaron en el query.
    range: { startDate: string | null; endDate: string | null }
    overview: DashboardOverview
    trend: DashboardTrendPoint[]
    trendGranularity: "day" | "week"
    // Ordenado por valor cotizado (suma de Quote.totalCost), NO por unidades: sumar bolsas de
    // presentaciones distintas (500 g vs 2 kg) no es comparable. Alimenta la lista y la dona.
    topProducts: DashboardTopProduct[]
    topSalespeople: DashboardTopSalesperson[]
    topRawMaterials: DashboardTopRawMaterial[]
}

function buildOverview(quotes: Quote[]): DashboardOverview {
    const totalQuotes = quotes.length
    const totalRevenue = sumMoney(quotes.map(quote => Number(quote.totalCost)))
    const totalPallets = quotes.reduce((sum, quote) => sum + Number(quote.requestedPallets), 0)
    const totalUnits = quotes.reduce((sum, quote) => sum + Number(quote.totalUnits), 0)
    const uniqueSalespeople = new Set(quotes.map(quote => quote.salespersonId)).size

    return {
        totalQuotes,
        totalRevenue,
        totalPallets,
        totalUnits,
        uniqueSalespeople,
        averageQuoteValue: totalQuotes > 0 ? roundMoney(toDecimal(totalRevenue).dividedBy(totalQuotes)) : 0,
    }
}

// `quotes` es el MISMO conjunto ya filtrado por rango que usa el resto del resumen. El largo del
// rango (y con él la granularidad) sale de los días pedidos; un extremo abierto se completa con la
// cotización más antigua/reciente. Días y semanas se cuentan en hora de Guatemala.
function buildTrend(
    quotes: Quote[],
    startDate?: string,
    endDate?: string
): { granularity: "day" | "week"; points: DashboardTrendPoint[] } {
    if (quotes.length === 0) return { granularity: "day", points: [] }

    const createdAts = quotes.map(quote => new Date(quote.get("createdAt") as Date))
    const timestamps = createdAts.map(createdAt => createdAt.getTime())
    const firstDay = startDate ?? businessDayKey(new Date(Math.min(...timestamps)))
    const lastDay = endDate ?? businessDayKey(new Date(Math.max(...timestamps)))
    const spanDays = Math.max(1, inclusiveDaySpan(firstDay, lastDay))
    const granularity: "day" | "week" = spanDays > MAX_DAILY_BUCKETS ? "week" : "day"
    const buckets = new Map<string, { count: number; revenue: Decimal }>()
    quotes.forEach((quote, index) => {
        const createdAt = createdAts[index]
        const key = granularity === "week" ? businessWeekKey(createdAt) : businessDayKey(createdAt)
        const bucket = buckets.get(key) ?? { count: 0, revenue: new Decimal(0) }
        bucket.count += 1
        bucket.revenue = bucket.revenue.plus(quote.totalCost)
        buckets.set(key, bucket)
    })

    const points = Array.from(buckets.entries())
        .map(([bucketStart, value]) => ({ bucketStart, count: value.count, revenue: roundMoney(value.revenue) }))
        .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))

    return { granularity, points }
}

type ProductAccumulator = Omit<DashboardTopProduct, "totalRevenue"> & { totalRevenue: Decimal }

// El nombre que queda aquí es el del snapshot más reciente -- solo el respaldo si el producto ya no se
// encuentra; applyLiveProductNames lo reemplaza por el nombre vivo del catálogo.
function groupProductsByRealId(quotes: Quote[]): DashboardTopProduct[] {
    const byProduct = new Map<number | string, ProductAccumulator>()

    for (const quote of quotes) {
        const productId = quote.quotedVariant?.parentProduct?.id ?? null
        const key = productId ?? `name:${quote.productDisplayName}`
        const entry = byProduct.get(key) ?? {
            productId,
            productDisplayName: quote.productDisplayName,
            quoteCount: 0,
            totalUnits: 0,
            totalPallets: 0,
            totalRevenue: new Decimal(0),
        }
        entry.productDisplayName = quote.productDisplayName
        entry.quoteCount += 1
        entry.totalUnits += Number(quote.totalUnits)
        entry.totalPallets += Number(quote.requestedPallets)
        entry.totalRevenue = entry.totalRevenue.plus(quote.totalCost)
        byProduct.set(key, entry)
    }

    return Array.from(byProduct.values()).map(entry => ({ ...entry, totalRevenue: roundMoney(entry.totalRevenue) }))
}

function buildTopProducts(quotes: Quote[]): DashboardTopProduct[] {
    return groupProductsByRealId(quotes)
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, TOP_LIST_LIMIT)
}

type SalespersonAccumulator = Omit<DashboardTopSalesperson, "totalRevenue"> & { totalRevenue: Decimal }

function buildTopSalespeople(quotes: Quote[]): DashboardTopSalesperson[] {
    const bySalesperson = new Map<number, SalespersonAccumulator>()

    for (const quote of quotes) {
        const salesperson = quote.quotingSalesperson
        if (!salesperson) continue

        const entry = bySalesperson.get(salesperson.id) ?? {
            salespersonId: salesperson.id,
            name: salesperson.name,
            companyName: salesperson.companyName ?? null,
            email: salesperson.email,
            quoteCount: 0,
            totalPallets: 0,
            totalRevenue: new Decimal(0),
        }
        entry.quoteCount += 1
        entry.totalPallets += Number(quote.requestedPallets)
        entry.totalRevenue = entry.totalRevenue.plus(quote.totalCost)
        bySalesperson.set(salesperson.id, entry)
    }

    return Array.from(bySalesperson.values())
        .map(entry => ({ ...entry, totalRevenue: roundMoney(entry.totalRevenue) }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, TOP_LIST_LIMIT)
}


type RawMaterialAccumulator = Omit<DashboardTopRawMaterial, "totalCost"> & { totalCost: Decimal }

function buildTopRawMaterials(quotes: Quote[]): DashboardTopRawMaterial[] {
    const byRawMaterial = new Map<number, RawMaterialAccumulator>()

    for (const quote of quotes) {
        const breakdown = quote.breakdown as unknown as QuoteBreakdownSnapshot
        for (const line of breakdown?.rawMaterials ?? []) {
            const entry = byRawMaterial.get(line.rawMaterialId) ?? {
                rawMaterialId: line.rawMaterialId,
                displayName: line.displayName,
                quoteCount: 0,
                totalCost: new Decimal(0),
            }
            entry.displayName = line.displayName
            entry.quoteCount += 1
            entry.totalCost = entry.totalCost.plus(line.lineTotal)
            byRawMaterial.set(line.rawMaterialId, entry)
        }
    }

    return Array.from(byRawMaterial.values())
        .map(entry => ({ ...entry, totalCost: roundMoney(entry.totalCost) }))
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, TOP_LIST_LIMIT)
}

// Nombres VIVOS del catálogo, en el idioma del admin, para las filas ya rankeadas. El snapshot guarda el
// nombre en el idioma de quien cotizó (un panel en español podía mostrar "Pineapple chunks"). Una
// consulta por id, solo de los ids del ranking (máximo TOP_LIST_LIMIT), sin filtrar por isActive (un
// producto desactivado sigue teniendo nombre). Solo cambia nombres: nunca montos ni el orden.
async function applyLiveProductNames(
    products: DashboardTopProduct[],
    language: ContentLanguage
): Promise<DashboardTopProduct[]> {
    const ids = products.map(product => product.productId).filter((id): id is number => id !== null)
    if (ids.length === 0) return products

    const rows = await Product.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ["id", "displayName"],
        include: [{ model: ProductTranslation, as: "translations", attributes: ["language", "displayName"] }],
    })
    const liveNames = new Map(rows.map(row => [row.id, pickTranslatedName(row.displayName, row.translations, language)]))

    return products.map(product => {
        const liveName = product.productId !== null ? liveNames.get(product.productId) : undefined
        return liveName ? { ...product, productDisplayName: liveName } : product
    })
}

// Mismo criterio que applyLiveProductNames, por rawMaterialId.
async function applyLiveRawMaterialNames(
    rawMaterials: DashboardTopRawMaterial[],
    language: ContentLanguage
): Promise<DashboardTopRawMaterial[]> {
    if (rawMaterials.length === 0) return rawMaterials

    const rows = await RawMaterial.findAll({
        where: { id: { [Op.in]: rawMaterials.map(rawMaterial => rawMaterial.rawMaterialId) } },
        attributes: ["id", "displayName"],
        include: [{ model: RawMaterialTranslation, as: "translations", attributes: ["language", "displayName"] }],
    })
    const liveNames = new Map(rows.map(row => [row.id, pickTranslatedName(row.displayName, row.translations, language)]))

    return rawMaterials.map(rawMaterial => {
        const liveName = liveNames.get(rawMaterial.rawMaterialId)
        return liveName ? { ...rawMaterial, displayName: liveName } : rawMaterial
    })
}

// startDate/endDate: días "YYYY-MM-DD" en hora de Guatemala (ver dashboard.schema.ts). `language`: el
// del admin (Accept-Language), solo para los nombres de productos y materias primas.
async function getSummary(
    startDate?: string,
    endDate?: string,
    language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE
): Promise<DashboardSummary> {
    const createdAtFilter = businessDayRangeFilter(startDate, endDate)

    const quotes = await Quote.findAll({
        where: createdAtFilter ? { createdAt: createdAtFilter } : {},
        include: [
            { model: Salesperson, as: "quotingSalesperson", attributes: ["id", "name", "companyName", "email"] },
            {
                model: ProductVariant,
                as: "quotedVariant",
                attributes: ["id"],
                include: [{ model: Product, as: "parentProduct", attributes: ["id"] }],
            },
        ],
        order: [["createdAt", "ASC"]],
    })

    const trend = buildTrend(quotes, startDate, endDate)
    const [topProducts, topRawMaterials] = await Promise.all([
        applyLiveProductNames(buildTopProducts(quotes), language),
        applyLiveRawMaterialNames(buildTopRawMaterials(quotes), language),
    ])

    return {
        range: { startDate: startDate ?? null, endDate: endDate ?? null },
        overview: buildOverview(quotes),
        trend: trend.points,
        trendGranularity: trend.granularity,
        topProducts,
        topSalespeople: buildTopSalespeople(quotes),
        topRawMaterials,
    }
}

export const dashboardService = {
    getSummary,
}
