import {z} from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"


const imageInputSchema = z.string().nullable().optional()

const productTranslationInputSchema = z.object({
    displayName: z.string().trim().min(1).max(120).optional(),
})

export const createProductSchema = z.object({
    subCategoryId: z.number().int().positive(),
    productTypeId: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(120),
    isOrganic: z.boolean().optional(),
    isCustomizable: z.boolean().optional(),
    // Ajuste manual de costo por unidad (costos aún no definidos en el catálogo). Nullable a
    // propósito: mandar null lo "elimina" (vuelve a no aplicar ningún ajuste) -- ver Product.model.ts.
    additionalCostPerUnit: z.number().nonnegative().nullable().optional(),
    image: imageInputSchema,
    translations: z.object({ en: productTranslationInputSchema.optional() }).optional(),
})


export const updateProductSchema = createProductSchema.partial()

export const productIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateProductStatusSchema = z.object({
    isActive: z.boolean(),
})

export const productQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type ProductTranslationInput = z.infer<typeof productTranslationInputSchema>
export type ProductQuery = z.infer<typeof productQuerySchema>
