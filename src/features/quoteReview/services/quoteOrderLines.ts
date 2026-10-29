import type { Transaction, WhereOptions } from "sequelize"
import { Op } from "sequelize"
import Quote from "../../quote/models/Quote.model"
import CustomQuote from "../../customQuote/models/CustomQuote.model"
import type { ProfitLineInput } from "../../pricing/services/quoteProfit"
import { digest } from "../../../shared/utils/digest.util"
import { roundMoney, toDecimal } from "../../../shared/utils/money.util"

export type QuoteOrderLineKind = "fixed" | "customizable"

// Una línea guardada del pedido, tal como quedó congelada (costos incluidos: solo la ven gerencia y
// el admin) + lo que necesita la ganancia por libra.
export interface QuoteOrderLine extends ProfitLineInput {
    kind: QuoteOrderLineKind
    quoteId: number
    productDisplayName: string
    variantLabel: string | null
    requestedPallets: number
    record: Record<string, any>
}

// Autor del pedido: siempre se filtra por él, así un UUID reutilizado por otro autor nunca mezcla
// líneas ajenas. Los pedidos del admin solo tienen productos definidos (su calculadora de productos
// nuevos no guarda).
export type QuoteOrderAuthor = { salespersonId: number } | { createdByUserId: number } | { staff: true }

function orderWhere(orderId: string): WhereOptions {
    return { breakdown: { order: { id: orderId } } } as WhereOptions
}

function authorWhere(author: QuoteOrderAuthor): WhereOptions {
    if ("salespersonId" in author) return { salespersonId: author.salespersonId }
    if ("createdByUserId" in author) return { createdByUserId: author.createdByUserId }
    return { createdByUserId: { [Op.ne]: null } }
}

function lineOf(kind: QuoteOrderLineKind, row: Quote | CustomQuote): QuoteOrderLine {
    const record = row.toJSON() as Record<string, any>
    return {
        kind,
        quoteId: record.id,
        productDisplayName: record.productDisplayName,
        variantLabel: record.variantLabel ?? null,
        requestedPallets: record.requestedPallets,
        totalUnits: record.totalUnits,
        totalCost: record.totalCost,
        // Productos nuevos anteriores al breakdown.production guardan el peso en su snapshot.
        netWeightGrams: record.breakdown?.production?.netWeightGrams ?? record.configuration?.snapshot?.presentation?.netWeightGrams ?? null,
        record,
    }
}

export async function loadQuoteOrderLines(orderId: string, author: QuoteOrderAuthor, transaction?: Transaction): Promise<QuoteOrderLine[]> {
    const fixed = await Quote.findAll({ where: { [Op.and]: [orderWhere(orderId), authorWhere(author)] }, order: [["id", "ASC"]], transaction })
    const custom = "salespersonId" in author
        ? await CustomQuote.findAll({ where: { [Op.and]: [orderWhere(orderId), { salespersonId: author.salespersonId }] }, order: [["id", "ASC"]], transaction })
        : []
    return [...fixed.map(row => lineOf("fixed", row)), ...custom.map(row => lineOf("customizable", row))]
}

// Huella de lo que se revisa: qué líneas y con qué costo, peso y unidades congelados. Cualquier línea
// agregada, quitada o distinta cambia la huella.
export function quoteOrderLinesDigest(lines: QuoteOrderLine[]): string {
    return digest(lines.map(line => [line.kind, line.quoteId, roundMoney(toDecimal(line.totalCost)), line.netWeightGrams == null ? null : String(line.netWeightGrams), line.totalUnits]))
}
