import z from "zod"

export const createProductVariantSchema = z.object({
    productId: z.number().int().positive(),
    presentationId: z.number().int().positive().optional(),
    packagingId: z.number().int().positive().optional(),
    intermediatePackagingId: z.number().int().positive().optional(),
    skuCode: z.string().trim().max(60).optional(),
    unitsPerPallet: z.number().int().positive().optional(),
    unitsPerBox: z.number().int().positive().optional(),
    unitsPerIntermediatePackage: z.number().int().positive().optional(),
})

export const productVariantIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateProductVariantSchema = createProductVariantSchema.partial()

export type CreateProductVariantInput = z.infer<typeof createProductVariantSchema>
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>
