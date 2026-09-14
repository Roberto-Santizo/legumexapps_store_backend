import z from "zod"

export const createProductVariantSchema = z.object({
    productId: z.number().int().positive(),
    presentationId: z.number().int().positive().optional(),
    intermediatePackagingId: z.number().int().positive().optional(),
    skuCode: z.string().trim().min(1).max(60),
    boxesPerPallet: z.number().int().positive(),
    bagsPerBox: z.number().int().positive(),
    unitsPerIntermediatePackage: z.number().int().positive().optional(),
})

export const productVariantIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const productVariantSkuCodeParamSchema = z.object({
    skuCode: z.string().trim().min(1).max(60),
})

export const updateProductVariantSchema = createProductVariantSchema.partial().extend({
    skuCode: createProductVariantSchema.shape.skuCode,
    boxesPerPallet: createProductVariantSchema.shape.boxesPerPallet,
    bagsPerBox: createProductVariantSchema.shape.bagsPerBox,
})

const skuLookupMaterialSchema = z.object({
    packagingId: z.number().int(),
    displayName: z.string(),
    quantity: z.number(),
})


export const productVariantSkuLookupSchema = z.object({
    skuCode: z.string(),
    productId: z.number().int(),
    productDisplayName: z.string(),
    presentationId: z.number().int().nullable(),
    presentationLabel: z.string().nullable(),
    boxesPerPallet: z.number().int().nullable(),
    bagsPerBox: z.number().int().nullable(),
    intermediatePackagingId: z.number().int().nullable(),
    unitsPerIntermediatePackage: z.number().int().nullable(),
    unitMaterials: z.array(skuLookupMaterialSchema),
    palletMaterials: z.array(skuLookupMaterialSchema),
})

export type CreateProductVariantInput = z.infer<typeof createProductVariantSchema>
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>
export type ProductVariantSkuLookup = z.infer<typeof productVariantSkuLookupSchema>
