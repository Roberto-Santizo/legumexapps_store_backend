import z from "zod"

const productRawMaterialShape = {
    productId: z.number().int().positive(),
    rawMaterialId: z.number().int().positive(),
    percentage: z.number().positive().max(100),
    displayOrder: z.number().int().optional(),
}

export const createProductRawMaterialSchema = z.object(productRawMaterialShape)

export const productRawMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateProductRawMaterialSchema = z.object(productRawMaterialShape).partial()

export type CreateProductRawMaterialInput = z.infer<typeof createProductRawMaterialSchema>
export type UpdateProductRawMaterialInput = z.infer<typeof updateProductRawMaterialSchema>
