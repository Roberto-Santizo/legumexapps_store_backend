import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

// Traducción a inglés -- opcional. Ver product.schema.ts (mismo caso: solo displayName) y
// shared/utils/translation.util.ts.
const ingredientTranslationInputSchema = z.object({
    displayName: z.string().trim().min(1).max(120).optional(),
})

export const createIngredientSchema = z.object({
    displayName: z.string().trim().min(1).max(120),
    ingredientType: z.enum(["fruit", "vegetable", "pulp", "other"]),
    isOrganic: z.boolean().optional(),
    isMixable: z.boolean().optional(),
    // Requeridos: el motor de cotización multiplica costPerUnit * cantidad, y en productos
    // personalizables además divide por costUnit.baseFactor. Si cualquiera de los dos falta,
    // el costo de esa línea queda mal (en 0, o sin convertir de gramos) sin ningún aviso.
    costPerUnit: z.number().nonnegative(),
    costUnitId: z.number().int().positive(),
    translations: z.object({ en: ingredientTranslationInputSchema.optional() }).optional(),
})

export const ingredientIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

// .partial() salvo costPerUnit/costUnitId: si se dejaran opcionales aquí, un admin podría
// editar un ingrediente existente y volver a dejarlos vacíos sin que el formulario lo impida.
export const updateIngredientSchema = createIngredientSchema.partial().extend({
    costPerUnit: createIngredientSchema.shape.costPerUnit,
    costUnitId: createIngredientSchema.shape.costUnitId,
})

export const ingredientQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreateIngredientInput = z.infer<typeof createIngredientSchema>
export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>
export type IngredientTranslationInput = z.infer<typeof ingredientTranslationInputSchema>
export type IngredientQuery = z.infer<typeof ingredientQuerySchema>
