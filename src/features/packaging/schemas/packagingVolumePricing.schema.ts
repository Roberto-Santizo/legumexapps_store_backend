import { z } from "zod"

export const packagingUnitCostSchema = z.number().nonnegative().max(999999.9999).multipleOf(0.000000000001)
const volumeQuantitySchema = z.number().positive().max(99999999.99).multipleOf(0.01)
export const DEFAULT_PACKAGING_VOLUME_LIMITS = { low: 5000, medium: 10000, high: 15000, fourth: 20000 } as const
const LEGACY_MEDIUM_VOLUME_LIMIT = 25000

export const packagingVolumePricingFields = {
    lowVolumeMaximumQuantity: volumeQuantitySchema.nullable().optional(),
    mediumVolumeMaximumQuantity: volumeQuantitySchema.nullable().optional(),
    // Preserve catalog references written by the earlier minimum-based form.
    mediumVolumeMinimumQuantity: volumeQuantitySchema.nullable().optional(),
    mediumVolumeUnitCost: packagingUnitCostSchema.nullable().optional(),
    highVolumeMinimumQuantity: volumeQuantitySchema.nullable().optional(),
    highVolumeUnitCost: packagingUnitCostSchema.nullable().optional(),
    highVolumeMaximumQuantity: volumeQuantitySchema.nullable().optional(),
    fourthVolumeMaximumQuantity: volumeQuantitySchema.nullable().optional(),
    fourthVolumeUnitCost: packagingUnitCostSchema.nullable().optional(),
}

const volumeFieldsSchema = z.object(packagingVolumePricingFields)
type VolumeFields = z.infer<typeof volumeFieldsSchema>

export function getPackagingVolumeLimits(value: VolumeFields) {
    return {
        low: value.lowVolumeMaximumQuantity ?? DEFAULT_PACKAGING_VOLUME_LIMITS.low,
        medium: value.mediumVolumeMaximumQuantity ?? value.mediumVolumeMinimumQuantity
            ?? (value.highVolumeMaximumQuantity == null ? LEGACY_MEDIUM_VOLUME_LIMIT : DEFAULT_PACKAGING_VOLUME_LIMITS.medium),
        // A missing third limit preserves existing catalogs with an open-ended third tier.
        high: value.highVolumeMaximumQuantity ?? null,
        fourth: value.highVolumeMaximumQuantity == null ? null : value.fourthVolumeMaximumQuantity ?? DEFAULT_PACKAGING_VOLUME_LIMITS.fourth,
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
    if (limits.high != null && limits.high <= limits.medium) {
        ctx.addIssue({ code: "custom", path: ["highVolumeMaximumQuantity"], message: "errors.packaging_volume_pricing_order" })
    }
    if (limits.high == null && (value.fourthVolumeUnitCost != null || value.fourthVolumeMaximumQuantity != null)) {
        ctx.addIssue({ code: "custom", path: ["highVolumeMaximumQuantity"], message: "errors.packaging_volume_pricing_order" })
    }
    if (limits.fourth != null && limits.high != null && limits.fourth <= limits.high) {
        ctx.addIssue({ code: "custom", path: ["fourthVolumeMaximumQuantity"], message: "errors.packaging_volume_pricing_order" })
    }
}

export const packagingVolumePricingSchema = z.object({
    classification: z.enum(["specific", "generic"]),
    unitCost: packagingUnitCostSchema,
    ...packagingVolumePricingFields,
}).superRefine(validatePackagingVolumePricing)
