import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

const packagingRoleEnum = z.enum(["unit", "intermediate", "pallet"])

export const createPackagingSchema = z.object({
    displayName: z.string().trim().min(1).max(80),
    packagingRole: packagingRoleEnum,
    packagingMaterial: z.string().trim().max(80).optional(),
    unitCost: z.number().nonnegative(),
})

export const packagingIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})


export const updatePackagingSchema = createPackagingSchema.partial().extend({
    packagingRole: createPackagingSchema.shape.packagingRole,
    unitCost: createPackagingSchema.shape.unitCost,
})

export const packagingQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreatePackagingInput = z.infer<typeof createPackagingSchema>
export type UpdatePackagingInput = z.infer<typeof updatePackagingSchema>
export type PackagingQuery = z.infer<typeof packagingQuerySchema>
