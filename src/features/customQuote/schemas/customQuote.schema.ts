import z from "zod"

// Cotización a la medida (World 2): lo que el representante ARMA. Estricto a propósito -- a
// diferencia de calculateQuoteSchema (que descarta claves desconocidas), acá una clave de más es un
// 400: el cliente nunca manda cantidades, cuentas de palet ni costos (salen de las listas de
// permitidos y de la presentación, en el servidor), y un payload que intente mandarlos se rechaza en
// vez de ignorarse en silencio.

export const MAX_CUSTOM_QUOTE_RAW_MATERIALS = 10
export const MAX_CUSTOM_QUOTE_INGREDIENTS = 10
export const MAX_CUSTOM_QUOTE_SELECTED_PACKAGING_OPTIONS = 50

const rawMaterialMixLineSchema = z.strictObject({
    rawMaterialId: z.number().int().positive(),
    percentage: z.number().positive().max(100).multipleOf(0.01),
})

// Gramos del ingrediente en UNA unidad de la presentación elegida (ej. 10 g de sal en una bolsa de
// 500 g). Tope duro en el servidor: nunca más que el peso neto, y el tope por kg de la lista.
const ingredientLineSchema = z.strictObject({
    ingredientId: z.number().int().positive(),
    gramsPerUnit: z.number().positive().multipleOf(0.001),
})

// Ids de FILA de customQuotePackagingOptions (uno por grupo de opciones), mismo contrato que
// selectedXMaterialIds en productos definidos.
const selectedPackagingOptionIdsSchema = z
    .array(z.number().int().positive())
    .max(MAX_CUSTOM_QUOTE_SELECTED_PACKAGING_OPTIONS)
    .optional()

export const customQuoteCalculationSchema = z.strictObject({
    subCategoryId: z.number().int().positive(),
    // Id de la Presentation (no de la fila de la lista): debe estar ofrecida y activa.
    presentationId: z.number().int().positive(),
    rawMaterialMix: z.array(rawMaterialMixLineSchema).min(1).max(MAX_CUSTOM_QUOTE_RAW_MATERIALS),
    ingredients: z.array(ingredientLineSchema).max(MAX_CUSTOM_QUOTE_INGREDIENTS).default([]),
    selectedUnitPackagingOptionIds: selectedPackagingOptionIdsSchema,
    selectedIntermediatePackagingOptionIds: selectedPackagingOptionIdsSchema,
    selectedPalletPackagingOptionIds: selectedPackagingOptionIdsSchema,
    isOrganic: z.boolean().default(false),
    requestedPallets: z.number().int().min(1),
    // Mismo criterio que calculateQuoteSchema: sin destino = transporte $0.
    destinationId: z.number().int().positive().optional(),
})

export type CustomQuoteCalculationInput = z.infer<typeof customQuoteCalculationSchema>
