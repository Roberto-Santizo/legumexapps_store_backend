import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

export const processingCostCalculationTypeEnum = z.enum(["per_weight", "percentage"])

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
