import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

// "percentage" existe en el enum a propósito (placeholder para una futura contingencia 2%) pero
// no tiene ninguna lógica de cálculo implementada todavía -- ver quote.service.ts. No se remueve
// del enum ni se bloquea su creación aquí: el schema solo valida forma, no si ya está "soportado".
export const processingCostCalculationTypeEnum = z.enum(["per_weight", "percentage"])

// Tope de cordura SOLO para calculationType "percentage" -- "value" es un campo compartido con
// "per_weight" (un monto en Q/libra, sin techo natural: un ingrediente/proceso caro legítimamente
// puede costar Q100+/lb), así que el límite no puede ir en el campo en general, solo cuando
// calculationType==="percentage" (ver refinePercentageBound). 100 se eligió porque este catálogo
// modela cargos ADITIVOS tipo "imprevistos/contingencia" (ej. 2%) -- un cargo así rara vez supera
// el 100% del costo base en una sola línea; sirve de red de seguridad contra un error de captura
// (ej. escribir "200" queriendo decir "2.00", o confundir el campo con un monto en vez de un %),
// no como un límite de negocio estrictamente exacto. Si el negocio necesita un cargo porcentual
// mayor a futuro, subir esta constante explícitamente, no borrarla.
const MAX_PERCENTAGE_VALUE = 100

const processingCostTranslationInputSchema = z.object({
    displayName: z.string().trim().min(1).max(120).optional(),
})

const processingCostShape = {
    displayName: z.string().trim().min(1).max(120),
    value: z.number().nonnegative(),
    calculationType: processingCostCalculationTypeEnum,
    translations: z.object({ en: processingCostTranslationInputSchema.optional() }).optional(),
}

// Mismo patrón que productIngredient.schema.ts::refineMinMax -- una función de refine compartida
// entre create/update, aplicada como último paso DESPUÉS de .partial()/.extend() (un ZodObject
// deja de tener esos métodos una vez envuelto por .refine(), así que el refine tiene que ir al
// final de la composición, no al principio).
function refinePercentageBound(data: { value: number; calculationType: string }): boolean {
    return data.calculationType !== "percentage" || data.value <= MAX_PERCENTAGE_VALUE
}

const createProcessingCostObject = z.object(processingCostShape)

export const createProcessingCostSchema = createProcessingCostObject.refine(refinePercentageBound, {
    message: `El valor de un costo tipo "Porcentaje" no puede superar ${MAX_PERCENTAGE_VALUE}`,
    path: ["value"],
})

export const processingCostIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

// value/calculationType son críticos para calculateQuote (ver quote.service.ts) -- se recuperan
// como requeridos dentro del partial, mismo patrón documentado para todo el repo (ver
// destination.schema.ts/ingredient.schema.ts: updateXSchema = createXSchema.partial().extend({...})).
const updateProcessingCostObject = createProcessingCostObject.partial().extend({
    value: createProcessingCostObject.shape.value,
    calculationType: createProcessingCostObject.shape.calculationType,
})

export const updateProcessingCostSchema = updateProcessingCostObject.refine(refinePercentageBound, {
    message: `El valor de un costo tipo "Porcentaje" no puede superar ${MAX_PERCENTAGE_VALUE}`,
    path: ["value"],
})

export const processingCostQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreateProcessingCostInput = z.infer<typeof createProcessingCostSchema>
export type UpdateProcessingCostInput = z.infer<typeof updateProcessingCostSchema>
export type ProcessingCostTranslationInput = z.infer<typeof processingCostTranslationInputSchema>
export type ProcessingCostQuery = z.infer<typeof processingCostQuerySchema>
