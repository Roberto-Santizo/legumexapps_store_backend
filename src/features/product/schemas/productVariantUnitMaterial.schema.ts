import z from "zod"

export const createProductVariantUnitMaterialSchema = z.object({
    productVariantId: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    quantityPerUnit: z.number().positive(),
    // Grupos de opciones (reemplaza isSwappable): null (default) es
    // una fila de receta incondicional. Un nombre de grupo la marca como alternativa dentro de ese
    // grupo; el servicio lo normaliza (espacios, grafía de un grupo ya existente en el SKU).
    optionGroup: z.string().trim().min(1).max(60).nullable().default(null),
    isDefault: z.boolean().default(false),
})

export const productVariantUnitMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

// optionGroup/isDefault recuperados con su default (no solo .optional() vía .partial(), que
// rompe el .default() de zod al envolverlo en .optional()) -- mismo criterio que quantityPerUnit:
// si el update omite el campo, resuelve a null/false en vez de quedar undefined/sin tocar.
export const updateProductVariantUnitMaterialSchema = createProductVariantUnitMaterialSchema.partial().extend({
    quantityPerUnit: createProductVariantUnitMaterialSchema.shape.quantityPerUnit,
    optionGroup: createProductVariantUnitMaterialSchema.shape.optionGroup,
    isDefault: createProductVariantUnitMaterialSchema.shape.isDefault,
})

export type CreateProductVariantUnitMaterialInput = z.infer<typeof createProductVariantUnitMaterialSchema>
export type UpdateProductVariantUnitMaterialInput = z.infer<typeof updateProductVariantUnitMaterialSchema>
