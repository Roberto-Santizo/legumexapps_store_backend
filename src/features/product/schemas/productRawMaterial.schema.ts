import z from "zod"

const productRawMaterialShape = {
    productId: z.number().int().positive(),
    rawMaterialId: z.number().int().positive(),
    // Solo aplica cuando el producto padre es de receta fija (!isCustomizable) -- ver
    // assertPercentageIfFixedRecipe en productRawMaterial.service.ts, que exige este valor de
    // forma async (acá queda opcional a nivel de schema por el mismo motivo que antes exigía
    // quantityValue: el schema no sabe si el producto es customizable o no).
    percentage: z.number().positive().max(100).optional(),
    minPercentage: z.number().min(0).max(100).optional(),
    maxPercentage: z.number().min(0).max(100).optional(),
    displayOrder: z.number().int().optional(),
}

const refineMinMax = (data: { minPercentage?: number; maxPercentage?: number }) =>
    data.minPercentage === undefined || data.maxPercentage === undefined || data.minPercentage <= data.maxPercentage

export const createProductRawMaterialSchema = z.object(productRawMaterialShape).refine(refineMinMax, {
    message: "minPercentage debe ser menor o igual a maxPercentage",
    path: ["minPercentage"],
})

export const productRawMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateProductRawMaterialSchema = z.object(productRawMaterialShape).partial().refine(refineMinMax, {
    message: "minPercentage debe ser menor o igual a maxPercentage",
    path: ["minPercentage"],
})

export type CreateProductRawMaterialInput = z.infer<typeof createProductRawMaterialSchema>
export type UpdateProductRawMaterialInput = z.infer<typeof updateProductRawMaterialSchema>
