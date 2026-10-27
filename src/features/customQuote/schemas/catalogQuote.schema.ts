import { genericSelectionsSchema } from "../../genericPackaging/schemas/genericPackaging.schema"
import z from "zod"
import { quoteOrderSchema } from "../../quoteOrder/schemas/quoteOrder.schema"

export const catalogQuoteInputSchema = z.strictObject({
    configurationOrigin: z.literal("generic_configuration").default("generic_configuration"),
    packagingSelections: genericSelectionsSchema.default([]),
    // Pallet kit type with several materials (e.g. wooden or cardboard corner boards): which one; never the quantity.
    palletKitSelections: z.array(z.strictObject({ type: z.enum(["TARIMA", "ESQUINERO", "STRETCH"]), packagingId: z.number().int().positive() })).max(3).default([]),
    categoryId: z.number().int().positive(),
    subCategoryId: z.number().int().positive(),
    configurationId: z.number().int().positive(),
    ingredientType: z.enum(["fruit", "vegetable", "pulp", "other"]),
    requestedPallets: z.number().int().positive().max(100000),
    rawMaterialMix: z.array(z.strictObject({
        rawMaterialId: z.number().int().positive(),
        percentage: z.number().positive().max(100).multipleOf(0.01),
    })).min(1).max(100),
})
export const catalogQuoteConfirmSchema = z.strictObject({
    input: catalogQuoteInputSchema,
    previewToken: z.string().min(1).max(4096),
    confirmationKey: z.string().uuid(),
    order: quoteOrderSchema.optional(),
})
export type CatalogQuoteInput = z.infer<typeof catalogQuoteInputSchema>
