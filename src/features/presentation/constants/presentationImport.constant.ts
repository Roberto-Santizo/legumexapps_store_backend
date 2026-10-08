export type PresentationImportField = "displayLabel" | "netWeightGrams"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const PRESENTATION_IMPORT_COLUMNS: Record<PresentationImportField, ImportColumnDef> = {
    displayLabel: { header: "Nombre", aliases: ["nombre"] },
    // El encabezado deja explícito "por unidad": copiar acá el peso del caso/caja inflaría en silencio
    // todos los costos por peso.
    netWeightGrams: { header: "Peso neto por unidad (g)", aliases: ["peso neto por unidad (g)", "peso neto por unidad", "peso neto (g)", "peso neto", "peso"] },
}

export const REQUIRED_PRESENTATION_IMPORT_FIELDS: PresentationImportField[] = ["displayLabel", "netWeightGrams"]

export const MAX_PRESENTATION_IMPORT_ROWS = 1000
