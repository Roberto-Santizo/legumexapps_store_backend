import z from "zod"

export const createProductVariantSchema = z.object({
    productId: z.number().int().positive(),
    // Requerido: cada SKU es, por definición, un producto en UNA presentación --
    // ya no se permite crear una variante sin presentación. También es inmutable una vez creada,
    // ver updateProductVariantSchema y productVariant.service.ts::assertPresentationNotChanged.
    // (productId, presentationId) ES la identidad del SKU -- ya no hay un skuCode
    // propio de la variante, ver productVariant.service.ts::assertPresentationNotAlreadyUsed.
    presentationId: z.number().int().positive(),
    boxesPerPallet: z.number().int().positive(),
    bagsPerBox: z.number().int().positive(),
    unitsPerIntermediatePackage: z.number().int().positive().optional(),
})

export const productVariantIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateProductVariantSchema = createProductVariantSchema.partial().extend({
    boxesPerPallet: createProductVariantSchema.shape.boxesPerPallet,
    bagsPerBox: createProductVariantSchema.shape.bagsPerBox,
    presentationId: createProductVariantSchema.shape.presentationId,
})

export type CreateProductVariantInput = z.infer<typeof createProductVariantSchema>
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>
