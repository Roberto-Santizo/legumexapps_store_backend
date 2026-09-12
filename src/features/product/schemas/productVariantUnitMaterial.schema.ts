import z from "zod"

export const createProductVariantUnitMaterialSchema = z.object({
    productVariantId: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    // Requerido, sin fallback silencioso (mismo criterio que
    // ProductVariantPalletMaterial.quantityValue): quantityPerUnit * unitCost * totalUnits es la
    // fórmula directa del costo de esta línea -- ver quoteService.calculateQuote. Default de
    // negocio 1 (la mayoría de materiales son "una unidad por unidad de producto") vive a nivel
    // de UI/modelo (ver ProductVariantUnitMaterial.model.ts defaultValue), no acá: el endpoint
    // siempre exige que venga explícito.
    quantityPerUnit: z.number().positive(),
})

export const productVariantUnitMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

// .partial() salvo quantityPerUnit -- no puede quedar vacío ni siquiera al editar una fila
// existente (mismo patrón que ProductVariantPalletMaterial).
export const updateProductVariantUnitMaterialSchema = createProductVariantUnitMaterialSchema.partial().extend({
    quantityPerUnit: createProductVariantUnitMaterialSchema.shape.quantityPerUnit,
})

export type CreateProductVariantUnitMaterialInput = z.infer<typeof createProductVariantUnitMaterialSchema>
export type UpdateProductVariantUnitMaterialInput = z.infer<typeof updateProductVariantUnitMaterialSchema>
