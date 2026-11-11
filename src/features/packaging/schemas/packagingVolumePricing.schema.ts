import { z } from "zod"

export const packagingUnitCostSchema = z.number().nonnegative().max(999999.9999).multipleOf(0.000000000001)
const volumeQuantitySchema = z.number().positive().max(99999999.99).multipleOf(0.01)
export const DEFAULT_PACKAGING_VOLUME_LIMITS = { low: 5000, medium: 25000 } as const

export const packagingVolumePricingFields = {
    lowVolumeMaximumQuantity: volumeQuantitySchema.nullable().optional(),
    mediumVolumeMaximumQuantity: volumeQuantitySchema.nullable().optional(),
    // Preserve catalog references written by the earlier minimum-based form.
    mediumVolumeMinimumQuantity: volumeQuantitySchema.nullable().optional(),
    mediumVolumeUnitCost: packagingUnitCostSchema.nullable().optional(),
    highVolumeMinimumQuantity: volumeQuantitySchema.nullable().optional(),
    highVolumeUnitCost: packagingUnitCostSchema.nullable().optional(),
}

const volumeFieldsSchema = z.object(packagingVolumePricingFields)
type VolumeFields = z.infer<typeof volumeFieldsSchema>

export function getPackagingVolumeLimits(value: Pick<VolumeFields, "lowVolumeMaximumQuantity" | "mediumVolumeMaximumQuantity" | "mediumVolumeMinimumQuantity">) {
    return {
        low: value.lowVolumeMaximumQuantity ?? DEFAULT_PACKAGING_VOLUME_LIMITS.low,
        medium: value.mediumVolumeMaximumQuantity ?? value.mediumVolumeMinimumQuantity ?? DEFAULT_PACKAGING_VOLUME_LIMITS.medium,
    }
}

export function validatePackagingVolumePricing(value: VolumeFields & { classification?: string }, ctx: z.RefinementCtx): void {
    if (value.classification === "generic") {
        for (const field of Object.keys(packagingVolumePricingFields) as (keyof VolumeFields)[]) {
            if (value[field] != null) ctx.addIssue({ code: "custom", path: [field], message: "errors.packaging_volume_pricing_specific" })
        }
    }
    const limits = getPackagingVolumeLimits(value)
    if (limits.medium <= limits.low) {
        ctx.addIssue({ code: "custom", path: ["mediumVolumeMaximumQuantity"], message: "errors.packaging_volume_pricing_order" })
    }
}

export const packagingVolumePricingSchema = z.object({
    classification: z.enum(["specific", "generic"]),
    unitCost: packagingUnitCostSchema,
    ...packagingVolumePricingFields,
}).superRefine(validatePackagingVolumePricing)
