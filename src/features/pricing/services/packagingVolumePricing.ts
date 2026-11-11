import Decimal from "decimal.js"
import { AppError } from "../../../shared/errors/AppError"
import { toDecimal } from "../../../shared/utils/money.util"
import { getPackagingVolumeLimits, packagingVolumePricingSchema } from "../../packaging/schemas/packagingVolumePricing.schema"

export interface PackagingVolumePricing {
    tier: "base" | "medium" | "high"
    materialQuantity: number
    minimumQuantity: number
    maximumQuantity?: number | null
    minimumExclusive?: boolean
    priceTier?: "base" | "medium" | "high"
}

type PackagingCostField = "unitCost" | "mediumVolumeUnitCost" | "highVolumeUnitCost"

interface PackagingPrices {
    code?: string
    classification?: string
    unitCost: number | string | null
    lowVolumeMaximumQuantity?: number | string | null
    mediumVolumeMaximumQuantity?: number | string | null
    mediumVolumeMinimumQuantity?: number | string | null
    mediumVolumeUnitCost?: number | string | null
    highVolumeMinimumQuantity?: number | string | null
    highVolumeUnitCost?: number | string | null
    getDataValue?: (field: PackagingCostField) => unknown
}

export function resolvePackagingCost(packaging: PackagingPrices | undefined, materialQuantity: Decimal): {
    unitCost: Decimal
    volumePricing?: PackagingVolumePricing
} {
    if (packaging?.classification !== "specific") return { unitCost: toDecimal(packaging?.unitCost ?? 0) }

    const nullableNumber = (value: number | string | null | undefined) => value == null ? null : Number(value)
    const parsed = packagingVolumePricingSchema.safeParse({
        classification: packaging.classification,
        unitCost: packaging.unitCost == null ? undefined : Number(packaging.unitCost),
        lowVolumeMaximumQuantity: nullableNumber(packaging.lowVolumeMaximumQuantity),
        mediumVolumeMaximumQuantity: nullableNumber(packaging.mediumVolumeMaximumQuantity),
        mediumVolumeMinimumQuantity: nullableNumber(packaging.mediumVolumeMinimumQuantity),
        mediumVolumeUnitCost: nullableNumber(packaging.mediumVolumeUnitCost),
        highVolumeMinimumQuantity: nullableNumber(packaging.highVolumeMinimumQuantity),
        highVolumeUnitCost: nullableNumber(packaging.highVolumeUnitCost),
    })
    if (!parsed.success || !materialQuantity.isFinite() || materialQuantity.lte(0)) {
        throw new AppError(422, "errors.packaging_volume_pricing_invalid", { code: packaging.code ?? "" })
    }

    const limits = getPackagingVolumeLimits(parsed.data)
    const tier = materialQuantity.lte(limits.low) ? "base" : materialQuantity.lte(limits.medium) ? "medium" : "high"
    const priceTier = tier === "high" && parsed.data.highVolumeUnitCost != null ? "high"
        : tier !== "base" && parsed.data.mediumVolumeUnitCost != null ? "medium" : "base"
    const costField: PackagingCostField = priceTier === "base" ? "unitCost" : `${priceTier}VolumeUnitCost`
    const minimumQuantity = tier === "base" ? 0 : tier === "medium" ? limits.low : limits.medium
    const maximumQuantity = tier === "base" ? limits.low : tier === "medium" ? limits.medium : null
    const rawCost = packaging.getDataValue?.(costField) ?? packaging[costField]
    if (typeof rawCost !== "number" && typeof rawCost !== "string") {
        throw new AppError(422, "errors.packaging_volume_pricing_invalid", { code: packaging.code ?? "" })
    }
    return { unitCost: toDecimal(rawCost), volumePricing: { tier, priceTier, materialQuantity: materialQuantity.toNumber(), minimumQuantity, minimumExclusive: true, maximumQuantity } }
}
