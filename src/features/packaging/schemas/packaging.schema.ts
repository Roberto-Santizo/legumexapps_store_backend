import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"
import { PACKAGING_MATERIAL_TYPES } from "../constants/packagingMaterialType.constant"

const packagingRoleEnum = z.enum(["unit", "intermediate", "pallet"])

const packagingFields = z.object({
    code: z.string().trim().min(1).max(60).optional(),
    displayName: z.string().trim().min(1).max(80),
    displayNameEn: z.string().trim().max(80).nullable().optional(),
    packagingRole: packagingRoleEnum,
    classification: z.enum(["specific", "generic"]),
    // Chosen for pallet materials; unit and intermediate ones get theirs from the level (packaging.service.ts).
    materialType: z.enum(PACKAGING_MATERIAL_TYPES).optional(),
    unitCost: z.number().nonnegative().max(999999.9999).multipleOf(0.000000000001),
    defaultQuantityBasis: z.enum(["per_box", "per_pallet"]).nullable().optional(),
    defaultQuantityValue: z.number().positive().max(99999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001).nullable().optional(),
})

export const packagingIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

function validateDefaults(value: { packagingRole: string; defaultQuantityBasis?: string | null; defaultQuantityValue?: number | null }, ctx: z.RefinementCtx) {
    const hasBasis = value.defaultQuantityBasis != null
    const hasValue = value.defaultQuantityValue != null
    if (hasBasis !== hasValue || (value.packagingRole !== "pallet" && (hasBasis || hasValue))) {
        ctx.addIssue({ code: "custom", path: [hasBasis ? "defaultQuantityValue" : "defaultQuantityBasis"], message: "errors.packaging_consumption_defaults" })
    }
}

// Specific materials carry the code the client's packaging already has; generic ones get one from the system.
function validateCode(value: { classification?: string; code?: string }, ctx: z.RefinementCtx) {
    if (value.classification === "generic" && value.code) ctx.addIssue({ code: "custom", path: ["code"], message: "errors.packaging_generic_code_forbidden" })
    if (value.classification === "specific" && !value.code) ctx.addIssue({ code: "custom", path: ["code"], message: "errors.packaging_code_required" })
}
const validatePackaging = (value: Parameters<typeof validateDefaults>[0] & Parameters<typeof validateCode>[0], ctx: z.RefinementCtx) => { validateDefaults(value, ctx); validateCode(value, ctx) }

export const packagingDefaultsSchema = packagingFields.pick({ packagingRole: true, defaultQuantityBasis: true, defaultQuantityValue: true }).superRefine(validateDefaults)

export const importLegacyPackagingSchema = packagingFields.superRefine(validatePackaging)

export const createPackagingSchema = packagingFields.extend({ displayNameEn: z.string().trim().min(1).max(80) }).superRefine(validatePackaging)
export const updatePackagingSchema = packagingFields.partial().extend({
    classification: packagingFields.shape.classification.optional(),
    isActive: z.boolean().optional(),
    packagingRole: packagingFields.shape.packagingRole,
    unitCost: packagingFields.shape.unitCost,
}).superRefine(validateDefaults)

export const packagingQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
    classification: z.enum(["specific", "generic"]).optional(),
    packagingRole: packagingRoleEnum.optional(),
    status: z.enum(["active", "inactive", "all"]).default("active"),
})

export type PackagingImportInput = z.infer<typeof importLegacyPackagingSchema>
export type CreatePackagingInput = z.infer<typeof createPackagingSchema>
export type UpdatePackagingInput = z.infer<typeof updatePackagingSchema>
export type PackagingQuery = z.infer<typeof packagingQuerySchema>
