import z from "zod"

export const createProductVariantUnitMaterialSchema = z.object({
    productVariantId: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    quantityPerUnit: z.number().positive(),
    // Grupos de opciones: null (default) es una fila fija. Un nombre de grupo la marca como alternativa
    // dentro de ese grupo; el servicio normaliza el nombre (espacios, grafía de un grupo ya existente).
    optionGroup: z.string().trim().min(1).max(60).nullable().default(null),
    optionGroupId: z.number().int().positive().nullable().optional(),
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
