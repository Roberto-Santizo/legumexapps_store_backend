import z from "zod"

const rawMaterialMixLineSchema = z.object({
    rawMaterialId: z.number().int().positive(),
    percentage: z.number().min(0).max(100).multipleOf(0.01),
})

export const calculateQuoteSchema = z.object({
    productVariantId: z.number().int().positive(),
    // Opcional: transporte apagado temporalmente para el representante; si llega, se valida igual.
    // calculateQuote resuelve el transporte a $0 cuando falta. El admin puede seguir mandándolo.
    destinationId: z.number().int().positive().optional(),
    requestedPallets: z.number().int().min(1),
    rawMaterialMix: z.array(rawMaterialMixLineSchema).optional(),
    // Grupos de opciones: un array POR NIVEL (los ids de fila solo son únicos dentro de su tabla) con
    // los ids de FILA elegidos, uno por grupo -- no el packagingId. El servicio lee el grupo de cada
    // fila, valida que pertenezca a este SKU y nivel y que no haya dos del mismo grupo. Un grupo sin id
    // enviado usa su default.
    selectedUnitMaterialIds: z.array(z.number().int().positive()).max(50).optional(),
    selectedIntermediateMaterialIds: z.array(z.number().int().positive()).max(50).optional(),
    selectedPalletMaterialIds: z.array(z.number().int().positive()).max(50).optional(),
})

// SOLO para las rutas del representante (POST /quotes/preview y POST /quotes): draftKey identifica el
// intento de cotización en curso (UUID generado por el wizard) para registrar el borrador y marcarlo
// convertido al guardar. Opcional. calculateQuoteSchema (rutas admin) no lo tiene.
export const salespersonQuoteSchema = calculateQuoteSchema.extend({
    draftKey: z.string().uuid().optional(),
})

export type RawMaterialMixLineInput = z.infer<typeof rawMaterialMixLineSchema>
export type CalculateQuoteInput = z.infer<typeof calculateQuoteSchema>
export type SalespersonQuoteInput = z.infer<typeof salespersonQuoteSchema>
export const sendQuotePdfEmailSchema = z.object({
    to: z.email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
})

export type SendQuotePdfEmailInput = z.infer<typeof sendQuotePdfEmailSchema>
