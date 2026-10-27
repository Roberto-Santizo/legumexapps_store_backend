import z from "zod"
import { quoteOrderSchema } from "../../quoteOrder/schemas/quoteOrder.schema"

export const calculateQuoteSchema = z.object({
    productVariantId: z.number().int().positive(),
    // Opcional: transporte apagado temporalmente para el representante; si llega, se valida igual.
    // calculateQuote resuelve el transporte a $0 cuando falta. El admin puede seguir mandándolo.
    destinationId: z.number().int().positive().optional(),
    requestedPallets: z.number().int().min(1),
    // Grupos de opciones: un array POR NIVEL (los ids de fila solo son únicos dentro de su tabla) con
    // los ids de FILA elegidos, uno por grupo -- no el packagingId. El servicio lee el grupo de cada
    // fila, valida que pertenezca a este SKU y nivel y que no haya dos del mismo grupo. Un grupo sin id
    // enviado usa su default.
    selectedUnitMaterialIds: z.array(z.number().int().positive()).max(50).optional(),
    selectedIntermediateMaterialIds: z.array(z.number().int().positive()).max(50).optional(),
    selectedPalletMaterialIds: z.array(z.number().int().positive()).max(50).optional(),
    // SKUs that use the pallet kit: which material of a kit type with several (e.g. corner board type), never the quantity.
    palletKitSelections: z.array(z.strictObject({ type: z.enum(["TARIMA", "ESQUINERO", "STRETCH"]), packagingId: z.number().int().positive() })).max(3).optional(),
})

// SOLO para las rutas del representante (POST /quotes/preview y POST /quotes): draftKey identifica el
// intento de cotización en curso (UUID generado por el wizard) para registrar el borrador y marcarlo
// convertido al guardar. Opcional. calculateQuoteSchema (rutas admin) no lo tiene.
export const salespersonQuoteSchema = calculateQuoteSchema.extend({
    draftKey: z.string().uuid().optional(),
    order: quoteOrderSchema.optional(),
})

// SOLO POST /admin/quotes (guardar desde el cotizador del admin): orderId agrupa las líneas del pedido en
// curso; el cliente lo resuelve el servidor desde el producto, nunca llega del navegador.
export const adminSaveQuoteSchema = calculateQuoteSchema.extend({
    orderId: z.string().uuid(),
})

export type CalculateQuoteInput = z.infer<typeof calculateQuoteSchema>
export type SalespersonQuoteInput = z.infer<typeof salespersonQuoteSchema>
export type AdminSaveQuoteInput = z.infer<typeof adminSaveQuoteSchema>
export const sendQuotePdfEmailSchema = z.object({
    to: z.email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
})

export type SendQuotePdfEmailInput = z.infer<typeof sendQuotePdfEmailSchema>

// SOLO POST /admin/quotes/send-email. Con quoteIds (las cotizaciones guardadas del pedido que va en el PDF)
// el envío queda registrado en ellas con el nombre y el correo del destinatario; sin quoteIds (p. ej. el
// detalle de una cotización a la medida) solo se envía, como antes. Llega como multipart: quoteIds es un
// arreglo JSON en texto.
export const adminSendQuotePdfEmailSchema = sendQuotePdfEmailSchema.extend({
    recipientName: z.string().trim().min(1).max(150).optional(),
    quoteIds: z.preprocess(
        value => {
            if (typeof value !== "string") return value
            try { return JSON.parse(value) } catch { return value }
        },
        z.array(z.number().int().positive()).min(1).max(100).refine(ids => new Set(ids).size === ids.length).optional()
    ),
}).refine(input => (input.recipientName === undefined) === (input.quoteIds === undefined), {
    message: "recipientName y quoteIds van juntos",
    path: ["recipientName"],
})

export type AdminSendQuotePdfEmailInput = z.infer<typeof adminSendQuotePdfEmailSchema>
