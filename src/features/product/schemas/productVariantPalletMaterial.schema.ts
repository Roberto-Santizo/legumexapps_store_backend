import z from "zod"

export const createProductVariantPalletMaterialSchema = z.object({
    productVariantId: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    quantityValue: z.number().positive(),
})

export const productVariantPalletMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})


export const updateProductVariantPalletMaterialSchema = createProductVariantPalletMaterialSchema.partial().extend({
    quantityValue: createProductVariantPalletMaterialSchema.shape.quantityValue,
})

export type CreateProductVariantPalletMaterialInput = z.infer<typeof createProductVariantPalletMaterialSchema>
export type UpdateProductVariantPalletMaterialInput = z.infer<typeof updateProductVariantPalletMaterialSchema>
