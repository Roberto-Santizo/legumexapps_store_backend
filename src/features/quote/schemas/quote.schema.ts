import z from "zod"

const ingredientMixLineSchema = z.object({
    ingredientId: z.number().int().positive(),
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
    ingredientMix: z.array(ingredientMixLineSchema).optional(),
})

export type IngredientMixLineInput = z.infer<typeof ingredientMixLineSchema>
export type CalculateQuoteInput = z.infer<typeof calculateQuoteSchema>
export const sendQuotePdfEmailSchema = z.object({
    to: z.email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
})

export type SendQuotePdfEmailInput = z.infer<typeof sendQuotePdfEmailSchema>
