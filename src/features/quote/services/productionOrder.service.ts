import Quote from "../models/Quote.model"
import CustomQuote from "../../customQuote/models/CustomQuote.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import User from "../../accessControl/user/models/User.model"
import type { QuoteOrderIdentity } from "../../quoteOrder/schemas/quoteOrder.schema"
import type { AdminQuoteListQuery } from "../schemas/adminQuoteList.schema"
import { businessDayRangeFilter } from "../../../shared/utils/businessTime.util"

// Fixed quotes saved from the admin calculator have a staff user as author instead of a representative.
function quoteAuthor(quote: Record<string, any>): { key: string; salesperson: { id: number; name: string; isAdmin?: true } } {
    if (quote.createdByUserId != null) return { key: `user:${quote.createdByUserId}`, salesperson: { id: quote.createdByUserId, name: quote.quotingUser?.name ?? "", isAdmin: true } }
    return { key: String(quote.salespersonId), salesperson: quote.quotingSalesperson ?? quote.requestingSalesperson ?? { id: quote.salespersonId, name: "" } }
}

// Group by author, customer and order UUID. Never infer an order from dates or product names.
export function groupProductionOrders(rows: { kind: "fixed" | "customizable"; quote: Record<string, any> }[]) {
    const groups = new Map<string, { id: string; clientName: string; salesperson: { id: number; name: string; isAdmin?: true }; createdAt: string; lines: Record<string, any>[] }>()
    for (const { kind, quote } of rows) {
        const order = quote.breakdown?.order as QuoteOrderIdentity | undefined
        const author = quoteAuthor(quote)
        const key = order ? `${author.key}:${order.id}:${order.clientId ?? "new-or-legacy"}:${order.clientName}` : `${kind}:${quote.id}`
        const createdAt = new Date(quote.createdAt).toISOString()
        let group = groups.get(key)
        if (!group) {
            group = { id: order?.id ?? `${kind}-${quote.id}`, clientName: order?.clientName ?? "", salesperson: author.salesperson, createdAt, lines: [] }
            groups.set(key, group)
        }
        if (createdAt < group.createdAt) group.createdAt = createdAt
        group.lines.push({ ...quote, boxesPerPallet: quote.boxesPerPallet ?? quote.breakdown?.production?.boxesPerPallet, quoteKind: kind })
    }
    return [...groups.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function listProductionOrders(filters: AdminQuoteListQuery = {}) {
    const include = [
        { model: Salesperson, as: "quotingSalesperson", attributes: ["id", "name"] },
        { model: User, as: "quotingUser", attributes: ["id", "name"] },
    ]
    const [fixed, custom] = await Promise.all([
        Quote.findAll({ include, order: [["createdAt", "ASC"]] }),
        CustomQuote.findAll({ include: [{ model: Salesperson, as: "requestingSalesperson", attributes: ["id", "name"] }], order: [["createdAt", "ASC"]] }),
    ])
    const groups = groupProductionOrders([
        ...fixed.map(row => ({ kind: "fixed" as const, quote: row.toJSON() })),
        ...custom.map(row => ({ kind: "customizable" as const, quote: row.toJSON() })),
    ])
    // Filter orders, not individual lines, so a date range never produces an incomplete report.
    const range = businessDayRangeFilter(filters.startDate, filters.endDate)
    if (!range) return groups
    return groups.filter(group => group.lines.some(line => {
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(line.createdAt))
        return (!filters.startDate || day >= filters.startDate) && (!filters.endDate || day <= filters.endDate)
    }))
}
