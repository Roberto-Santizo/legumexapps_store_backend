import Decimal from "decimal.js"
import { AppError } from "../../../shared/errors/AppError"
import { toDecimal } from "../../../shared/utils/money.util"
import { getPackagingVolumeLimits, packagingVolumePricingSchema } from "../../packaging/schemas/packagingVolumePricing.schema"

type PackagingVolumeTier = "base" | "medium" | "high" | "fourth"

export interface PackagingVolumePricing {
    tier: PackagingVolumeTier
    materialQuantity: number
    minimumQuantity: number
    maximumQuantity?: number | null
    referenceMaximumQuantity?: number
    minimumExclusive?: boolean
    priceTier?: PackagingVolumeTier
}

type PackagingCostField = "unitCost" | "mediumVolumeUnitCost" | "highVolumeUnitCost" | "fourthVolumeUnitCost"
const COST_FIELDS: Record<PackagingVolumeTier, PackagingCostField> = {
    base: "unitCost",
    medium: "mediumVolumeUnitCost",
    high: "highVolumeUnitCost",
    fourth: "fourthVolumeUnitCost",
}

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
    highVolumeMaximumQuantity?: number | string | null
    fourthVolumeMaximumQuantity?: number | string | null
    fourthVolumeUnitCost?: number | string | null
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
        highVolumeMaximumQuantity: nullableNumber(packaging.highVolumeMaximumQuantity),
        fourthVolumeMaximumQuantity: nullableNumber(packaging.fourthVolumeMaximumQuantity),
        fourthVolumeUnitCost: nullableNumber(packaging.fourthVolumeUnitCost),
    })
    if (!parsed.success || !materialQuantity.isFinite() || materialQuantity.lte(0)) {
        throw new AppError(422, "errors.packaging_volume_pricing_invalid", { code: packaging.code ?? "" })
    }

    const limits = getPackagingVolumeLimits(parsed.data)
    const tier: PackagingVolumeTier = materialQuantity.lte(limits.low) ? "base"
        : materialQuantity.lte(limits.medium) ? "medium"
        : limits.high != null && materialQuantity.gt(limits.high) ? "fourth" : "high"
    const tiers: PackagingVolumeTier[] = ["base", "medium", "high", "fourth"]
    const priceTier = tiers.slice(0, tiers.indexOf(tier) + 1).reverse()
        .find(candidate => parsed.data[COST_FIELDS[candidate]] != null) ?? "base"
    const costField = COST_FIELDS[priceTier]
    const minimumQuantity = tier === "base" ? 0 : tier === "medium" ? limits.low : tier === "high" ? limits.medium : limits.high!
    const maximumQuantity = tier === "base" ? limits.low : tier === "medium" ? limits.medium : tier === "high" ? limits.high : null
    const rawCost = packaging.getDataValue?.(costField) ?? packaging[costField]
    if (typeof rawCost !== "number" && typeof rawCost !== "string") {
        throw new AppError(422, "errors.packaging_volume_pricing_invalid", { code: packaging.code ?? "" })
    }
    return { unitCost: toDecimal(rawCost), volumePricing: {
        tier, priceTier, materialQuantity: materialQuantity.toNumber(), minimumQuantity, minimumExclusive: true, maximumQuantity,
        ...(tier === "fourth" && limits.fourth != null ? { referenceMaximumQuantity: limits.fourth } : {}),
    } }
}
