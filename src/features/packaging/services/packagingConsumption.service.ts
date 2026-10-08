import { AppError } from "../../../shared/errors/AppError"

export type PalletConsumptionRule = { quantityBasis: "per_box" | "per_pallet"; quantityValue: number }
type CatalogRule = { code: string; defaultQuantityBasis?: string | null; defaultQuantityValue?: number | string | null }

// Explicit overrides, persisted association, then catalog defaults. Never infer from labels.
export function resolvePalletConsumptionRule(packaging: CatalogRule, explicit?: { quantityBasis?: string; quantityValue?: number | null }, existing?: PalletConsumptionRule): PalletConsumptionRule {
    const hasExplicit = explicit?.quantityBasis != null || explicit?.quantityValue != null
    const basis = hasExplicit ? explicit?.quantityBasis : existing ? existing.quantityBasis : packaging.defaultQuantityBasis
    const value = hasExplicit ? explicit?.quantityValue : existing ? existing.quantityValue : packaging.defaultQuantityValue
    if ((basis !== "per_box" && basis !== "per_pallet") || value == null || !(Number(value) > 0) || !Number.isFinite(Number(value)) || Number(value) > 99999999.99 || Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) > 0.000001) {
        throw new AppError(422, hasExplicit ? "errors.pallet_consumption_invalid" : "errors.packaging_consumption_missing", { code: packaging.code })
    }
    return { quantityBasis: basis, quantityValue: Number(value) }
}
