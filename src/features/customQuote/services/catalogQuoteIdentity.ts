import { createHash } from "node:crypto"
import { toDecimal } from "../../../shared/utils/money.util"
import { materialGroupIdentity } from "../../../shared/utils/materialGroupIdentity.util"
import { bucketMaterialsByGroup, type GroupedMaterialRow } from "../../quote/services/quoteMaterialSelection"
import type ProductVariant from "../../product/models/ProductVariant.model"

export function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
export const decimalString = (value: number | string | null | undefined) => toDecimal(value).toString()

export function configurationIdentity(variant: ProductVariant, subCategoryId: number) {
    const rows = [
        ...(variant.unitMaterials ?? []).map(row => ({ level: "unit", packagingId: row.packagingId, group: materialGroupIdentity(row), default: row.isDefault, quantity: decimalString(row.quantityPerUnit), basis: "per_unit", cost: decimalString(row.usedUnitMaterial?.unitCost) })),
        ...(variant.intermediateMaterials ?? []).map(row => ({ level: "intermediate", packagingId: row.packagingId, group: materialGroupIdentity(row), default: row.isDefault, quantity: "1", basis: "per_intermediate", cost: decimalString(row.usedIntermediateMaterial?.unitCost) })),
        ...(variant.palletMaterials ?? []).map(row => ({ level: "pallet", packagingId: row.packagingId, group: materialGroupIdentity(row), default: row.isDefault, quantity: decimalString(row.quantityValue), basis: row.quantityBasis, cost: decimalString(row.usedPalletMaterial?.unitCost) })),
    ].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0)
    return { version: 1, subCategoryId, presentationId: variant.presentationId,
        netWeightGrams: decimalString(variant.sizePresentation?.netWeightGrams), unitsPerBox: variant.bagsPerBox,
        boxesPerPallet: variant.boxesPerPallet, unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage ?? null, rows }
}

export function validConfiguration(variant: ProductVariant): boolean {
    if (!variant.isActive || !variant.parentProduct?.isActive || !variant.sizePresentation?.isActive) return false
    if (![variant.bagsPerBox, variant.boxesPerPallet].every(value => Number.isSafeInteger(value) && value > 0)) return false
    if (!variant.sizePresentation.netWeightGrams || !toDecimal(variant.sizePresentation.netWeightGrams).isFinite() || !toDecimal(variant.sizePresentation.netWeightGrams).isPositive()) return false
    const unit = variant.unitMaterials ?? [], intermediate = variant.intermediateMaterials ?? [], pallet = variant.palletMaterials ?? []
    if (!unit.length || !pallet.length) return false
    if (intermediate.length && (!Number.isSafeInteger(variant.unitsPerIntermediatePackage) || variant.unitsPerIntermediatePackage <= 0)) return false
    for (const rows of [unit, intermediate, pallet]) {
        const { groups } = bucketMaterialsByGroup<GroupedMaterialRow>(rows)
        if ([...groups.values()].some(group => group.rows.filter(row => row.isDefault).length !== 1)) return false
    }
    const costValid = (packaging: { isActive: boolean; packagingRole: string; unitCost: number } | undefined, role: string) =>
        packaging?.isActive === true && packaging.packagingRole === role && packaging.unitCost != null && toDecimal(packaging.unitCost).isFinite() && !toDecimal(packaging.unitCost).isNegative()
    return unit.every(row => costValid(row.usedUnitMaterial, "unit") && row.quantityPerUnit != null && toDecimal(row.quantityPerUnit).isFinite() && !toDecimal(row.quantityPerUnit).isNegative())
        && intermediate.every(row => costValid(row.usedIntermediateMaterial, "intermediate"))
        && pallet.every(row => costValid(row.usedPalletMaterial, "pallet") && ["per_box", "per_pallet"].includes(row.quantityBasis) && row.quantityValue != null && toDecimal(row.quantityValue).isFinite() && !toDecimal(row.quantityValue).isNegative())
}
