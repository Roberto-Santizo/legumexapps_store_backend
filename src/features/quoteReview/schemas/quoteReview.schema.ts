import z from "zod"
import { QUOTE_ORDER_REVIEW_STATUSES } from "../models/QuoteOrderReview.model"
import { clientEmailSchema } from "../../client/schemas/client.schema"

// El pedido se identifica por el UUID que comparten sus líneas (breakdown.order.id).
export const quoteOrderIdParamSchema = z.object({
    orderId: z.string().uuid(),
})

// Representante: el correo del cliente al que irá la cotización aprobada.
export const quoteReviewSubmitSchema = z.strictObject({
    clientEmail: clientEmailSchema,
})

// Monto por libra: aquí solo forma; rango (0 al tope), decimales y tope los valida
// pricing/services/quoteProfit.ts::parseProfitPerPound, el único lugar con esa regla.
const profitPerPoundSchema = z.union([z.number().finite(), z.string().trim().min(1).max(20)])

export const quoteReviewPreviewSchema = z.strictObject({
    profitPerPound: profitPerPoundSchema,
})

// linesDigest: la huella de las líneas que gerencia vio en el detalle; si el pedido cambió desde
// entonces, la aprobación se rechaza en lugar de fijar un precio sobre líneas que nadie revisó.
export const quoteReviewApproveSchema = z.strictObject({
    profitPerPound: profitPerPoundSchema,
    linesDigest: z.string().regex(/^[0-9a-f]{64}$/),
})

// Calculadora del admin: el admin define su propia ganancia, sin revisión.
export const adminQuoteOrderPricingSchema = quoteReviewPreviewSchema

export const listQuoteReviewsQuerySchema = z.strictObject({
    status: z.enum(QUOTE_ORDER_REVIEW_STATUSES).optional(),
})

// Reenvío al cliente: solo el PDF (multipart), ningún otro campo.
export const quoteReviewClientEmailSchema = z.strictObject({})

export type QuoteReviewSubmitInput = z.infer<typeof quoteReviewSubmitSchema>
export type QuoteReviewPreviewInput = z.infer<typeof quoteReviewPreviewSchema>
export type QuoteReviewApproveInput = z.infer<typeof quoteReviewApproveSchema>
export type ListQuoteReviewsQuery = z.infer<typeof listQuoteReviewsQuerySchema>
