import z from "zod"

export const createProductVariantPalletMaterialSchema = z.object({
    productVariantId: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    quantityValue: z.number().positive(),
    // Default + opcional (2026-09-21) -- mismo criterio que
    // productVariantUnitMaterial.schema.ts, ver el comentario ahí.
    isSwappable: z.boolean().default(false),
    isDefault: z.boolean().default(false),
})

export const productVariantPalletMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})


export const updateProductVariantPalletMaterialSchema = createProductVariantPalletMaterialSchema.partial().extend({
    quantityValue: createProductVariantPalletMaterialSchema.shape.quantityValue,
    isSwappable: createProductVariantPalletMaterialSchema.shape.isSwappable,
    isDefault: createProductVariantPalletMaterialSchema.shape.isDefault,
})

export type CreateProductVariantPalletMaterialInput = z.infer<typeof createProductVariantPalletMaterialSchema>
export type UpdateProductVariantPalletMaterialInput = z.infer<typeof updateProductVariantPalletMaterialSchema>
