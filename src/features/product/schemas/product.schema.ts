import {z} from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"


const imageInputSchema = z.string().nullable().optional()

const productTranslationInputSchema = z.object({
    displayName: z.string().trim().min(1).max(120).optional(),
})

export const createProductSchema = z.object({
    // Código manual del producto, editable, único (case-insensitive -- ver
    // product.service.ts::assertCodigoIsUnique). trim() en vez de solo min(1): un valor de puros
    // espacios no debe colarse como "válido" antes de la comparación de unicidad.
    codigo: z.string().trim().min(1).max(60),
    subCategoryId: z.number().int().positive(),
    productTypeId: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(120),
    isOrganic: z.boolean().optional(),
    isCustomizable: z.boolean().optional(),
    additionalCostPerUnit: z.number().nonnegative().nullable().optional(),
    image: imageInputSchema,
    translations: z.object({ en: productTranslationInputSchema.optional() }).optional(),
})


// codigo se recupera como requerido -- no puede quedar vacío ni siquiera al editar (mismo
// patrón que el resto de campos críticos del repo, ver memoria del proyecto).
export const updateProductSchema = createProductSchema.partial().extend({
    codigo: createProductSchema.shape.codigo,
})

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
