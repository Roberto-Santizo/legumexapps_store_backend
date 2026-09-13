export type PresentationImportField = "displayLabel" | "netWeightGrams" | "categoryId"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const PRESENTATION_IMPORT_COLUMNS: Record<PresentationImportField, ImportColumnDef> = {
    displayLabel: { header: "Nombre", aliases: ["nombre"] },
    // El encabezado deja explícito "por unidad" -- NUNCA el peso del caso/caja (ver
    // presentation.service.ts::bulkImportPresentations y la memoria del proyecto: copiar el peso
    // del caso acá infla en silencio todos los costos por peso, exactamente el tipo de error que
    // este campo requerido busca evitar).
    netWeightGrams: { header: "Peso neto por unidad (g)", aliases: ["peso neto por unidad (g)", "peso neto por unidad", "peso neto (g)", "peso neto", "peso"] },
    categoryId: { header: "Categoría", aliases: ["categoria", "categoría"] },
}

export const REQUIRED_PRESENTATION_IMPORT_FIELDS: PresentationImportField[] = ["displayLabel", "netWeightGrams"]

export const MAX_PRESENTATION_IMPORT_ROWS = 1000
