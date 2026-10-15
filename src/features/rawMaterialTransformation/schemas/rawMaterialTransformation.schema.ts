import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"
import { createRawMaterialSchema } from "../../rawMaterial/schemas/rawMaterial.schema"
import {
    MAX_TRANSFORMATION_COST_LINES,
    TRANSFORMATION_COST_BASES,
    TRANSFORMATION_COST_CATEGORIES,
} from "../constants/rawMaterialTransformation.constant"

const nonNegativeAmount = z.number().finite().nonnegative().max(1_000_000_000)

const costLineSchema = z.strictObject({
    category: z.enum(TRANSFORMATION_COST_CATEGORIES),
    conceptName: z.string().trim().min(1).max(120),
    // Cero es válido: un gasto que no aplica a este producto se deja en 0 o se elimina.
    amount: nonNegativeAmount,
    costBasis: z.enum(TRANSFORMATION_COST_BASES),
    // Obligatorio solo para per_unit / per_batch; la regla la aplica el servicio con un error traducido.
    poundsPerUnit: z.number().finite().positive().max(9_999_999_999).nullable().optional(),
})

// Datos de cálculo (todos los importes en USD): se usan tanto en la vista previa como al guardar. El
// cliente nunca envía el costo final; el servidor siempre lo recalcula.
const calculationFields = {
    inputCostPerPound: nonNegativeAmount,
    freightPerPound: nonNegativeAmount,
    yieldPercentage: z.number().finite().gt(0).lte(100),
    costs: z.array(costLineSchema).max(MAX_TRANSFORMATION_COST_LINES),
}

export const previewRawMaterialTransformationSchema = z.strictObject(calculationFields)

// Reemplazo completo en create y update (PUT): todos los campos alimentan el costo, ninguno puede
// quedar opcional al editar (ver la convención "campos críticos" en CLAUDE.md §8).
export const saveRawMaterialTransformationSchema = z.strictObject({
    unprocessedCode: z.string().trim().min(1).max(60),
    unprocessedName: z.string().trim().min(1).max(120),
    processedCode: createRawMaterialSchema.shape.code,
    processedName: createRawMaterialSchema.shape.displayName,
    processedNameEn: z.string().trim().max(120).optional(),
    ingredientType: createRawMaterialSchema.shape.ingredientType,
    ...calculationFields,
})

export const rawMaterialTransformationIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const rawMaterialTransformationQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().max(120).optional(),
})

export type PreviewRawMaterialTransformationInput = z.infer<typeof previewRawMaterialTransformationSchema>
export type SaveRawMaterialTransformationInput = z.infer<typeof saveRawMaterialTransformationSchema>
export type RawMaterialTransformationQuery = z.infer<typeof rawMaterialTransformationQuerySchema>
