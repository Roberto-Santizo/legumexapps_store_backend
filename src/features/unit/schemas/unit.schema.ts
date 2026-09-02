import z from "zod"
import { UNIT_CATALOG_KEYS } from "../constants/unitCatalog"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"


export const createUnitSchema = z.object({
    unitKey: z.enum(UNIT_CATALOG_KEYS),
})

export const unitIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateUnitSchema = createUnitSchema

export const unitQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreateUnitInput = z.infer<typeof createUnitSchema>
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>
export type UnitQuery = z.infer<typeof unitQuerySchema>
