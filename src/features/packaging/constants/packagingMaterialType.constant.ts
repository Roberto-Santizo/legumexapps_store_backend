import { INITIAL_MATERIAL_TYPES } from "./packagingImport.constant"

// Every packaging material keeps its type. Unit and intermediate materials have one type each (set by the
// system); pallet materials are chosen by the user. Fixed-consumption types carry their per-pallet rule.
export const PALLET_MATERIAL_TYPES = ["CAJA", "TARIMA", "ESQUINERO", "STRETCH", "OTRO"] as const
export const PACKAGING_MATERIAL_TYPES = ["INDIVIDUAL", "INTERMEDIO", ...PALLET_MATERIAL_TYPES] as const
export type PalletMaterialType = typeof PALLET_MATERIAL_TYPES[number]
export type PackagingMaterialType = typeof PACKAGING_MATERIAL_TYPES[number]

// The pallet kit covers these types for every pallet; nothing else may repeat them.
export const PALLET_KIT_TYPES = ["TARIMA", "ESQUINERO", "STRETCH"] as const
export type PalletKitType = typeof PALLET_KIT_TYPES[number]
export const isPalletKitType = (type: string | null | undefined): type is PalletKitType => PALLET_KIT_TYPES.includes(type as PalletKitType)

// Catalog consumption of the fixed-rule pallet types (caja 1 por caja; tarima 1, esquinero 4, stretch 93.3 por pallet).
export function fixedPalletConsumption(type: Exclude<PalletMaterialType, "OTRO">) {
    const rule = INITIAL_MATERIAL_TYPES[type]
    return { defaultQuantityBasis: rule.basis as "per_box" | "per_pallet", defaultQuantityValue: rule.quantity as number }
}
