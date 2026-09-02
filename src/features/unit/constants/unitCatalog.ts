
export type UnitCatalogKey =
    | "gram"
    | "kilogram"
    | "pound"
    | "ounce"
    | "ton"
    | "milliliter"
    | "liter"
    | "gallon"
    | "piece"
    | "dozen"

export interface UnitCatalogEntry {
    key: UnitCatalogKey
    displayName: string
    unitType: "weight" | "volume" | "count"
    baseFactor: number
}

const UNIT_CATALOG: UnitCatalogEntry[] = [
    { key: "gram", displayName: "Gramo", unitType: "weight", baseFactor: 1 },
    { key: "kilogram", displayName: "Kilogramo", unitType: "weight", baseFactor: 1000 },
    { key: "pound", displayName: "Libra", unitType: "weight", baseFactor: 453.592 },
    { key: "ounce", displayName: "Onza", unitType: "weight", baseFactor: 28.3495 },
    { key: "ton", displayName: "Tonelada", unitType: "weight", baseFactor: 1000000 },
    { key: "milliliter", displayName: "Mililitro", unitType: "volume", baseFactor: 1 },
    { key: "liter", displayName: "Litro", unitType: "volume", baseFactor: 1000 },
    { key: "gallon", displayName: "Galón", unitType: "volume", baseFactor: 3785.41 },
    { key: "piece", displayName: "Unidad", unitType: "count", baseFactor: 1 },
    { key: "dozen", displayName: "Docena", unitType: "count", baseFactor: 12 },
]

export const UNIT_CATALOG_KEYS = UNIT_CATALOG.map(entry => entry.key) as [UnitCatalogKey, ...UnitCatalogKey[]]

export function getUnitCatalogEntry(key: string): UnitCatalogEntry | undefined {
    return UNIT_CATALOG.find(entry => entry.key === key)
}
