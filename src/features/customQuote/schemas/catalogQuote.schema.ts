import z from "zod"

export const catalogQuoteInputSchema = z.strictObject({
    categoryId: z.number().int().positive(),
    subCategoryId: z.number().int().positive(),
    configurationId: z.number().int().positive(),
    ingredientType: z.enum(["fruit", "vegetable", "pulp", "other"]),
    isOrganic: z.boolean(),
    requestedPallets: z.number().int().positive().max(100000),
    rawMaterialMix: z.array(z.strictObject({
        rawMaterialId: z.number().int().positive(),
        percentage: z.number().positive().max(100).multipleOf(0.01),
    })).min(1).max(100),
    selectedUnitMaterialIds: z.array(z.number().int().positive()).max(50).default([]),
    selectedIntermediateMaterialIds: z.array(z.number().int().positive()).max(50).default([]),
    selectedPalletMaterialIds: z.array(z.number().int().positive()).max(50).default([]),
})
export const catalogQuoteConfirmSchema = z.strictObject({
    input: catalogQuoteInputSchema,
    previewToken: z.string().min(1).max(4096),
    confirmationKey: z.string().uuid(),
})
export type CatalogQuoteInput = z.infer<typeof catalogQuoteInputSchema>
