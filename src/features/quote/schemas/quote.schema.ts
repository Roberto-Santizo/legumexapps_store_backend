import z from "zod"

const rawMaterialMixLineSchema = z.object({
    rawMaterialId: z.number().int().positive(),
    percentage: z.number().min(0).max(100).multipleOf(0.01),
})

export const calculateQuoteSchema = z.object({
    productVariantId: z.number().int().positive(),
    // Opcional (2026-09-10): transporte "apagado" temporalmente -- el cliente ya no elige
    // destino en su cotizador (ver quoteCalculatorForm.component.tsx), así que este campo puede
    // no llegar en el body. Si SÍ llega, sigue validado igual que antes (entero positivo).
    // quoteService.calculateQuote resuelve transporte a $0 cuando falta. El admin (cotizador
    // interno) sigue pudiendo mandarlo -- mismo schema para ambas rutas.
    destinationId: z.number().int().positive().optional(),
    requestedPallets: z.number().int().min(1),
    rawMaterialMix: z.array(rawMaterialMixLineSchema).optional(),
    // Grupos de opciones (2026-09-24, ver CLAUDE.md #4 -- reemplaza los tres ids únicos
    // selectedXMaterialId): un array POR NIVEL (los ids de fila solo son únicos dentro de su propia
    // tabla de join) con los ids de FILA elegidos, uno por grupo de opciones -- no el packagingId.
    // El cliente nunca declara a qué grupo pertenece cada id: quoteService lo lee de la fila, valida
    // que sea una fila agrupada de este SKU en este nivel y que no haya dos del mismo grupo (mismo
    // principio que rawMaterialMix). Un grupo sin id enviado usa su default.
    selectedUnitMaterialIds: z.array(z.number().int().positive()).max(50).optional(),
    selectedIntermediateMaterialIds: z.array(z.number().int().positive()).max(50).optional(),
    selectedPalletMaterialIds: z.array(z.number().int().positive()).max(50).optional(),
})

export type RawMaterialMixLineInput = z.infer<typeof rawMaterialMixLineSchema>
export type CalculateQuoteInput = z.infer<typeof calculateQuoteSchema>
export const sendQuotePdfEmailSchema = z.object({
    to: z.email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
})

export type SendQuotePdfEmailInput = z.infer<typeof sendQuotePdfEmailSchema>
