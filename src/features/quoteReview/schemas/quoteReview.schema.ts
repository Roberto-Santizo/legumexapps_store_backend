import z from "zod"
import { QUOTE_ORDER_REVIEW_STATUSES, QUOTE_REVIEW_DELIVERY_RECIPIENTS } from "../models/QuoteOrderReview.model"
import { clientEmailSchema } from "../../client/schemas/client.schema"

// El pedido se identifica por el UUID que comparten sus líneas (breakdown.order.id).
export const quoteOrderIdParamSchema = z.object({
    orderId: z.string().uuid(),
})

// Representante: el correo del cliente es opcional. Si llega, se valida y se guarda; si no, el pedido
// igual llega a gerencia (nunca se inventa un correo).
export const quoteReviewSubmitSchema = z.strictObject({
    clientEmail: clientEmailSchema.optional(),
})

// Monto por libra: aquí solo forma; rango (0 al tope), decimales y tope los valida
// pricing/services/quoteProfit.ts::parseProfitPerPound, el único lugar con esa regla.
const profitPerPoundSchema = z.union([z.number().finite(), z.string().trim().min(1).max(20)])

export const quoteReviewPreviewSchema = z.strictObject({
    profitPerPound: profitPerPoundSchema,
})

// Correo del cliente que gerencia confirma o escribe al enviar con copia al cliente. Llega como campo
// de multipart: vacío equivale a no enviarlo (se usa el que ya tiene el pedido).
const deliveryClientEmailSchema = z.preprocess(
    value => (typeof value === "string" && value.trim() === "" ? undefined : value),
    clientEmailSchema.optional()
)

const deliveryRecipientsSchema = z.enum(QUOTE_REVIEW_DELIVERY_RECIPIENTS)

// Envío comercial autorizado por gerencia (después de aprobar, o para reintentar uno fallido).
export const quoteReviewDeliverySchema = z.strictObject({
    recipients: deliveryRecipientsSchema,
    clientEmail: deliveryClientEmailSchema,
})

// linesDigest: la huella de las líneas que gerencia vio en el detalle; si el pedido cambió desde
// entonces, la aprobación se rechaza en lugar de fijar un precio sobre líneas que nadie revisó.
// delivery: decisión explícita de gerencia (sin valor por defecto: aprobar nunca envía por omisión).
// "none" = solo aprobar (se avisa al representante, sin PDF ni montos).
export const quoteReviewApproveSchema = z.strictObject({
    profitPerPound: profitPerPoundSchema,
    linesDigest: z.string().regex(/^[0-9a-f]{64}$/),
    delivery: z.enum(["none", ...QUOTE_REVIEW_DELIVERY_RECIPIENTS]),
    clientEmail: deliveryClientEmailSchema,
})

// Rechazo: el motivo es obligatorio (es lo que se le explica al representante).
export const quoteReviewRejectSchema = z.strictObject({
    reason: z.string().trim().min(5).max(500),
})

// Calculadora del admin: el admin define su propia ganancia, sin revisión.
export const adminQuoteOrderPricingSchema = quoteReviewPreviewSchema

export const listQuoteReviewsQuerySchema = z.strictObject({
    status: z.enum(QUOTE_ORDER_REVIEW_STATUSES).optional(),
})

export type QuoteReviewSubmitInput = z.infer<typeof quoteReviewSubmitSchema>
export type QuoteReviewPreviewInput = z.infer<typeof quoteReviewPreviewSchema>
export type QuoteReviewApproveInput = z.infer<typeof quoteReviewApproveSchema>
export type QuoteReviewDeliveryInput = z.infer<typeof quoteReviewDeliverySchema>
export type QuoteReviewRejectInput = z.infer<typeof quoteReviewRejectSchema>
export type ListQuoteReviewsQuery = z.infer<typeof listQuoteReviewsQuerySchema>
