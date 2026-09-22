import z from "zod"

// Sin cantidad propia (a diferencia de Unit/Pallet material) -- el motor sigue leyendo
// ProductVariant.unitsPerIntermediatePackage, compartido entre cualquier alternativa elegida
// (decisión de negocio 2026-09-21, ver CLAUDE.md #4).
export const createProductVariantIntermediateMaterialSchema = z.object({
    productVariantId: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    isSwappable: z.boolean().default(false),
    isDefault: z.boolean().default(false),
})

export const productVariantIntermediateMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

// isSwappable/isDefault recuperados con su default -- mismo criterio que
// productVariantUnitMaterial.schema.ts, ver el comentario ahí.
export const updateProductVariantIntermediateMaterialSchema = createProductVariantIntermediateMaterialSchema.partial().extend({
    isSwappable: createProductVariantIntermediateMaterialSchema.shape.isSwappable,
    isDefault: createProductVariantIntermediateMaterialSchema.shape.isDefault,
})

export type CreateProductVariantIntermediateMaterialInput = z.infer<typeof createProductVariantIntermediateMaterialSchema>
export type UpdateProductVariantIntermediateMaterialInput = z.infer<typeof updateProductVariantIntermediateMaterialSchema>
