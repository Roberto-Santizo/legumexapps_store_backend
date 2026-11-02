import z from "zod"
import QuoteOrderReview from "../models/QuoteOrderReview.model"
import type { QuoteOrderLineKind } from "./quoteOrderLines"

const amount = z.number().finite()

// Una línea de `pricing.lines` tal como la guarda quoteReview.service::pricingOf al aprobar. Se valida
// al leer: un registro con otra forma se descarta en vez de romper los listados que lo recorren.
const storedPricingLineSchema = z.object({
    kind: z.enum(["fixed", "customizable"]),
    quoteId: z.number().int().positive(),
    netPounds: amount,
    profitPerPound: amount,
    profitTotal: amount,
    finalPrice: amount,
})

export type ApprovedQuoteProfit = Pick<z.infer<typeof storedPricingLineSchema>, "netPounds" | "profitPerPound" | "profitTotal" | "finalPrice">
type ApprovedLine = z.infer<typeof storedPricingLineSchema>

// Líneas con precio final aprobado por gerencia (o por el admin al cotizar). Sale del `pricing`
// guardado al aprobar: solo trae las líneas que de verdad se revisaron, del autor del pedido, así un
// listado admin nunca muestra una cotización sin aprobar ni un precio ajeno. Con orderId, solo ese pedido.
async function approvedLines(orderId?: string): Promise<ApprovedLine[]> {
    const reviews = await QuoteOrderReview.findAll({ where: { status: "approved", ...(orderId ? { orderId } : {}) }, attributes: ["orderId", "pricing"] })
    const lines: ApprovedLine[] = []
    for (const review of reviews) {
        const stored = (review.pricing as { lines?: unknown } | null)?.lines
        if (!Array.isArray(stored)) {
            console.warn(`[quoteReview] pedido ${review.orderId} aprobado sin pricing.lines válido: se omite de los listados`)
            continue
        }
        for (const candidate of stored) {
            const parsed = storedPricingLineSchema.safeParse(candidate)
            if (parsed.success) lines.push(parsed.data)
            else console.warn(`[quoteReview] pedido ${review.orderId}: línea de pricing con forma inesperada, se omite`)
        }
    }
    return lines
}

// Ganancia aprobada de cada línea de un tipo, por id (los ids de quotes y customQuotes se repiten).
export async function approvedQuoteProfits(kind: QuoteOrderLineKind, orderId?: string): Promise<Map<number, ApprovedQuoteProfit>> {
    const profits = new Map<number, ApprovedQuoteProfit>()
    for (const { kind: lineKind, quoteId, netPounds, profitPerPound, profitTotal, finalPrice } of await approvedLines(orderId)) {
        if (lineKind === kind) profits.set(quoteId, { netPounds, profitPerPound, profitTotal, finalPrice })
    }
    return profits
}

// Ids aprobados de ambos tipos, para los listados que mezclan las dos tablas (órdenes de producción).
export async function approvedQuoteIds(): Promise<Record<QuoteOrderLineKind, number[]>> {
    const ids: Record<QuoteOrderLineKind, number[]> = { fixed: [], customizable: [] }
    for (const line of await approvedLines()) ids[line.kind].push(line.quoteId)
    return ids
}
