import z from "zod"

export const createProductVariantSchema = z.object({
    skuCode: z.string().trim().min(1).max(60),
    productId: z.number().int().positive(),
    // Requerido: cada SKU es un producto en UNA presentación, inmutable una vez creada
    // (productVariant.service.ts::assertPresentationNotChanged).
    presentationId: z.number().int().positive(),
    boxesPerPallet: z.number().int().positive(),
    bagsPerBox: z.number().int().positive(),
    unitsPerIntermediatePackage: z.number().int().positive().optional(),
})

export const productVariantIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateProductVariantSchema = createProductVariantSchema.partial().extend({
    skuCode: createProductVariantSchema.shape.skuCode,
    boxesPerPallet: createProductVariantSchema.shape.boxesPerPallet,
    bagsPerBox: createProductVariantSchema.shape.bagsPerBox,
    presentationId: createProductVariantSchema.shape.presentationId,
})

export type CreateProductVariantInput = z.infer<typeof createProductVariantSchema>
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>
