import { Op } from "sequelize"
import Decimal from "decimal.js"
import Quote from "../../quote/models/Quote.model"
import Customer from "../../customer/models/Customer.model"
import ProductVariant from "../../product/models/ProductVariant.model"
import Product from "../../product/models/Product.model"
import { toDecimal, roundMoney, sumMoney } from "../../../shared/utils/money.util"

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_DAILY_BUCKETS = 62
const TOP_LIST_LIMIT = 8
interface RawMaterialSnapshotLine {
    ingredientId: number
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
    uniqueCustomers: number
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

interface DashboardTopCustomer {
    customerId: number
    name: string
    companyName: string | null
    email: string
    quoteCount: number
    totalPallets: number
    totalRevenue: number
}

interface DashboardTopIngredient {
    ingredientId: number
    displayName: string
    quoteCount: number
    totalCost: number
}

interface DashboardSummary {
    range: { startDate: Date | null; endDate: Date | null }
    overview: DashboardOverview
    trend: DashboardTrendPoint[]
    // El front usa esto para rotular cada punto ("dia" vs "semana del ...") sin tener que
    // adivinar la granularidad a partir del espaciado entre bucketStart.
    trendGranularity: "day" | "week"
    topProducts: DashboardTopProduct[]
    // Mismos productos, mismo shape, ordenados por ingresos en vez de unidades -- solo para el
    // pastel de participación de ingresos (ver buildTopProductsByRevenue).
    topProductsByRevenue: DashboardTopProduct[]
    topCustomers: DashboardTopCustomer[]
    topIngredients: DashboardTopIngredient[]
}

function endOfDay(date: Date): Date {
    const result = new Date(date)
    result.setUTCHours(23, 59, 59, 999)
    return result
}

function dayKey(date: Date): string {
    return date.toISOString().slice(0, 10)
}

// Lunes de la semana ISO a la que pertenece `date`, como clave "YYYY-MM-DD".
function weekKey(date: Date): string {
    const monday = new Date(date)
    const day = monday.getUTCDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    monday.setUTCDate(monday.getUTCDate() + diffToMonday)
    monday.setUTCHours(0, 0, 0, 0)
    return dayKey(monday)
}

function buildOverview(quotes: Quote[]): DashboardOverview {
    const totalQuotes = quotes.length
    // totalRevenue es dinero -- se suma en decimal.js (sumMoney, mismo punto único de redondeo
    // que usa quoteService, ver money.util.ts) para no filtrar ruido de floats nativos
    // (ej. 0.30010000000000003 en vez de 0.3001) directo en el JSON de /admin/dashboard/summary.
    // totalPallets/totalUnits son conteos enteros, no dinero -- `+` nativo es seguro para esos.
    const totalRevenue = sumMoney(quotes.map(quote => Number(quote.totalCost)))
    const totalPallets = quotes.reduce((sum, quote) => sum + Number(quote.requestedPallets), 0)
    const totalUnits = quotes.reduce((sum, quote) => sum + Number(quote.totalUnits), 0)
    const uniqueCustomers = new Set(quotes.map(quote => quote.customerId)).size

    return {
        totalQuotes,
        totalRevenue,
        totalPallets,
        totalUnits,
        uniqueCustomers,
        averageQuoteValue: totalQuotes > 0 ? roundMoney(toDecimal(totalRevenue).dividedBy(totalQuotes)) : 0,
    }
}

function buildTrend(
    quotes: Quote[],
    startDate?: Date,
    endDate?: Date
): { granularity: "day" | "week"; points: DashboardTrendPoint[] } {
    if (quotes.length === 0) return { granularity: "day", points: [] }

    const timestamps = quotes.map(quote => new Date(quote.get("createdAt") as Date).getTime())
    const rangeStartMs = startDate ? startDate.getTime() : Math.min(...timestamps)
    const rangeEndMs = endDate ? endOfDay(endDate).getTime() : Math.max(...timestamps)
    const spanDays = Math.max(1, Math.ceil((rangeEndMs - rangeStartMs) / MS_PER_DAY) + 1)
    const granularity: "day" | "week" = spanDays > MAX_DAILY_BUCKETS ? "week" : "day"

    // revenue se acumula como Decimal (no Number) mientras se recorren las cotizaciones -- solo
    // se convierte a Number una vez, al construir `points`, con roundMoney. Sumar en Decimal y
    // convertir a Number en cada iteración reintroduciría el mismo ruido de floats nativos que
    // sumMoney existe para evitar (ver money.util.ts): el redondeo debe pasar una sola vez, al
    // final, no en cada paso intermedio.
    const buckets = new Map<string, { count: number; revenue: Decimal }>()
    for (const quote of quotes) {
        const createdAt = new Date(quote.get("createdAt") as Date)
        const key = granularity === "week" ? weekKey(createdAt) : dayKey(createdAt)
        const bucket = buckets.get(key) ?? { count: 0, revenue: new Decimal(0) }
        bucket.count += 1
        bucket.revenue = bucket.revenue.plus(quote.totalCost)
        buckets.set(key, bucket)
    }

    const points = Array.from(buckets.entries())
        .map(([bucketStart, value]) => ({ bucketStart, count: value.count, revenue: roundMoney(value.revenue) }))
        .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))

    return { granularity, points }
}

// "Mas vendido" en un cotizador se mide por lo unico que existe: cotizaciones guardadas por los
// clientes (ver memoria del proyecto -- no hay concepto de orden/venta confirmada todavia).
// Se agrupa por el id real del producto (via ProductVariant.parentProduct), no por el nombre
// congelado en la cotizacion, para que un producto renombrado no se parta en dos filas; el nombre
// mostrado sí es el snapshot mas reciente (las cotizaciones vienen ordenadas ASC por fecha, así
// que la ultima escritura en el Map es la mas reciente).
// totalRevenue se acumula en Decimal (no Number) por la misma razón que en buildTrend -- el
// redondeo a precisión monetaria pasa una sola vez, al convertir a plano en el `map` final.
type ProductAccumulator = Omit<DashboardTopProduct, "totalRevenue"> & { totalRevenue: Decimal }

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
        .sort((a, b) => b.totalUnits - a.totalUnits)
        .slice(0, TOP_LIST_LIMIT)
}

// Mismo agrupamiento que buildTopProducts, pero ordenado por ingresos -- lo usa el front para
// armar el pastel de participación de ingresos por producto (buildTopProducts está ordenado por
// unidades, que no es el orden correcto para esa gráfica).
function buildTopProductsByRevenue(quotes: Quote[]): DashboardTopProduct[] {
    return groupProductsByRealId(quotes)
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, TOP_LIST_LIMIT)
}

type CustomerAccumulator = Omit<DashboardTopCustomer, "totalRevenue"> & { totalRevenue: Decimal }

function buildTopCustomers(quotes: Quote[]): DashboardTopCustomer[] {
    const byCustomer = new Map<number, CustomerAccumulator>()

    for (const quote of quotes) {
        const customer = quote.quotingCustomer
        if (!customer) continue

        const entry = byCustomer.get(customer.id) ?? {
            customerId: customer.id,
            name: customer.name,
            companyName: customer.companyName ?? null,
            email: customer.email,
            quoteCount: 0,
            totalPallets: 0,
            totalRevenue: new Decimal(0),
        }
        entry.quoteCount += 1
        entry.totalPallets += Number(quote.requestedPallets)
        entry.totalRevenue = entry.totalRevenue.plus(quote.totalCost)
        byCustomer.set(customer.id, entry)
    }

    return Array.from(byCustomer.values())
        .map(entry => ({ ...entry, totalRevenue: roundMoney(entry.totalRevenue) }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, TOP_LIST_LIMIT)
}

// Se rankea por costo total consumido (no por cantidad) porque cada ingrediente puede estar
// cotizado en una unidad de costeo distinta (kg, lb, litro...) -- sumar cantidades crudas entre
// ingredientes de unidades distintas no significa nada, pero el costo ya esta en la misma moneda.
type IngredientAccumulator = Omit<DashboardTopIngredient, "totalCost"> & { totalCost: Decimal }

function buildTopIngredients(quotes: Quote[]): DashboardTopIngredient[] {
    const byIngredient = new Map<number, IngredientAccumulator>()

    for (const quote of quotes) {
        const breakdown = quote.breakdown as unknown as QuoteBreakdownSnapshot
        for (const line of breakdown?.rawMaterials ?? []) {
            const entry = byIngredient.get(line.ingredientId) ?? {
                ingredientId: line.ingredientId,
                displayName: line.displayName,
                quoteCount: 0,
                totalCost: new Decimal(0),
            }
            entry.displayName = line.displayName
            entry.quoteCount += 1
            entry.totalCost = entry.totalCost.plus(line.lineTotal)
            byIngredient.set(line.ingredientId, entry)
        }
    }

    return Array.from(byIngredient.values())
        .map(entry => ({ ...entry, totalCost: roundMoney(entry.totalCost) }))
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, TOP_LIST_LIMIT)
}

async function getSummary(startDate?: Date, endDate?: Date): Promise<DashboardSummary> {
    const createdAtFilter: Record<symbol, Date> = {}
    if (startDate) createdAtFilter[Op.gte] = startDate
    if (endDate) createdAtFilter[Op.lte] = endOfDay(endDate)

    const quotes = await Quote.findAll({
        where: Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {},
        include: [
            { model: Customer, as: "quotingCustomer", attributes: ["id", "name", "companyName", "email"] },
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

    return {
        range: { startDate: startDate ?? null, endDate: endDate ?? null },
        overview: buildOverview(quotes),
        trend: trend.points,
        trendGranularity: trend.granularity,
        topProducts: buildTopProducts(quotes),
        topProductsByRevenue: buildTopProductsByRevenue(quotes),
        topCustomers: buildTopCustomers(quotes),
        topIngredients: buildTopIngredients(quotes),
    }
}

export const dashboardService = {
    getSummary,
}
