import z from "zod"

export const createProductVariantPalletMaterialSchema = z.object({
    productVariantId: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    quantityValue: z.number().positive(),
    // Grupos de opciones -- mismo criterio que
    // productVariantUnitMaterial.schema.ts, ver el comentario ahí.
    optionGroup: z.string().trim().min(1).max(60).nullable().default(null),
    isDefault: z.boolean().default(false),
})

export const productVariantPalletMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})


export const updateProductVariantPalletMaterialSchema = createProductVariantPalletMaterialSchema.partial().extend({
    quantityValue: createProductVariantPalletMaterialSchema.shape.quantityValue,
    optionGroup: createProductVariantPalletMaterialSchema.shape.optionGroup,
    isDefault: createProductVariantPalletMaterialSchema.shape.isDefault,
})

export type CreateProductVariantPalletMaterialInput = z.infer<typeof createProductVariantPalletMaterialSchema>
export type UpdateProductVariantPalletMaterialInput = z.infer<typeof updateProductVariantPalletMaterialSchema>
