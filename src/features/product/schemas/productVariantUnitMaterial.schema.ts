import z from "zod"

export const createProductVariantUnitMaterialSchema = z.object({
    productVariantId: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    quantityPerUnit: z.number().positive(),
    // Default + opcional (2026-09-21, ver CLAUDE.md #4): isSwappable=false (default) es una fila
    // de receta incondicional, sin cambio de comportamiento. isSwappable=true la marca como
    // alternativa del menú que el cliente puede elegir en el cotizador para este nivel.
    isSwappable: z.boolean().default(false),
    isDefault: z.boolean().default(false),
})

export const productVariantUnitMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

// isSwappable/isDefault recuperados con su default (no solo .optional() vía .partial(), que
// rompe el .default() de zod al envolverlo en .optional()) -- mismo criterio que quantityPerUnit:
// si el update omite el campo, resuelve a false en vez de quedar undefined/sin tocar.
export const updateProductVariantUnitMaterialSchema = createProductVariantUnitMaterialSchema.partial().extend({
    quantityPerUnit: createProductVariantUnitMaterialSchema.shape.quantityPerUnit,
    isSwappable: createProductVariantUnitMaterialSchema.shape.isSwappable,
    isDefault: createProductVariantUnitMaterialSchema.shape.isDefault,
})

export type CreateProductVariantUnitMaterialInput = z.infer<typeof createProductVariantUnitMaterialSchema>
export type UpdateProductVariantUnitMaterialInput = z.infer<typeof updateProductVariantUnitMaterialSchema>
