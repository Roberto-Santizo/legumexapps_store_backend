import { normalizeImportText } from "../../../shared/utils/excelImport.util"

export const JUICE_IMPORT_SHEETS = { materials: "COSTO MP", formulas: "% MP", presentations: "COSTO POR PRESENTACIÓN" } as const
export const MAX_JUICE_IMPORT_ROWS = 1000
export const MAX_JUICE_IMPORT_COLUMNS = 102 // Two reference columns + 100 juices.
export const JUICE_MATERIAL_HEADERS = {
    kind: "Tipo", code: "Código", displayName: "Nombre", purchaseUnit: "Unidad",
    yieldPoundsPerLiter: "Libras por litro", costPerUnit: "Costo unitario",
} as const
export const JUICE_PRESENTATION_HEADERS = {
    juice: "Jugo (SKU o nombre)", displayLabel: "Presentación", mlPerBottle: "ML por botella",
    bottlesPerCase: "Botellas por caja", casesPerPallet: "Cajas por palet",
    boxUnitCost: "Costo caja", stickerUnitCost: "Costo sticker 1", stickerQuantityPerCase: "Cantidad sticker 1",
    secondStickerUnitCost: "Costo sticker 2", secondStickerQuantityPerCase: "Cantidad sticker 2",
    bottleUnitCost: "Costo botella", capUnitCost: "Costo tapa", pricePerPound: "PRICE LB", marginPerCase: "Margen por caja",
} as const

// Same tolerant header plumbing as product imports; canonical templates define the layout.
export function juiceImportColumns<T extends string>(headers: Record<T, string>) {
    return Object.fromEntries(Object.entries(headers).map(([field, header]) => [field, {
        header: String(header), aliases: [normalizeImportText(String(header)), normalizeImportText(field)],
    }])) as Record<T, { header: string; aliases: string[] }>
}
