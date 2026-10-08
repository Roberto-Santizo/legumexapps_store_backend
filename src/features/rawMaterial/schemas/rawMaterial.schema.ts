import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

const rawMaterialTranslationInputSchema = z.object({
    displayName: z.string().trim().min(1).max(120).optional(),
})

// costUnitId no es parte del input: la libra se fija en el servidor. costPerUnit (costo por libra)
// es obligatorio.
export const createRawMaterialSchema = z.object({
    code: z.string().trim().min(1).max(60),
    displayName: z.string().trim().min(1).max(120),
    ingredientType: z.enum(["fruit", "vegetable", "pulp", "other"]),
    isOrganic: z.boolean().optional(),
    isMixable: z.boolean().optional(),
    costPerUnit: z.number().nonnegative(),
    translations: z.object({ en: rawMaterialTranslationInputSchema.optional() }).optional(),
})

export const rawMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateRawMaterialSchema = createRawMaterialSchema.partial().extend({
    code: createRawMaterialSchema.shape.code,
    costPerUnit: createRawMaterialSchema.shape.costPerUnit,
})

export const rawMaterialQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreateRawMaterialInput = z.infer<typeof createRawMaterialSchema>
export type UpdateRawMaterialInput = z.infer<typeof updateRawMaterialSchema>
export type RawMaterialTranslationInput = z.infer<typeof rawMaterialTranslationInputSchema>
export type RawMaterialQuery = z.infer<typeof rawMaterialQuerySchema>
