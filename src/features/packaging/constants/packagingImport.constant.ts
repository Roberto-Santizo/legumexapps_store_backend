
export type PackagingImportField = "code" | "displayName" | "packagingRole" | "unitCost" | "defaultQuantityBasis" | "defaultQuantityValue"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const PACKAGING_IMPORT_COLUMNS: Record<PackagingImportField, ImportColumnDef> = {
    // Primera columna de la plantilla a propósito (ver buildPackagingImportTemplate) -- el
    // mapeo real de columnas es por nombre de encabezado (mapImportHeaders), no por posición.
    code: { header: "Código", aliases: ["codigo", "código", "code"] },
    displayName: { header: "Nombre", aliases: ["nombre"] },
    packagingRole: { header: "Rol del material", aliases: ["rol del material", "rol"] },
    unitCost: { header: "Costo por unidad (USD)", aliases: ["costo por unidad (usd)", "costo por unidad (q)", "costo por unidad", "costo"] },
    defaultQuantityBasis: { header: "FORMA DE CONSUMO", aliases: ["forma de consumo", "defaultquantitybasis"] },
    defaultQuantityValue: { header: "CANTIDAD DE CONSUMO", aliases: ["cantidad de consumo", "defaultquantityvalue"] },
}

export const REQUIRED_PACKAGING_IMPORT_FIELDS: PackagingImportField[] = ["code", "displayName", "packagingRole", "unitCost"]

export const PACKAGING_ROLE_LABELS: Record<string, string> = {
    unit: "Empaque individual",
    intermediate: "Empaque intermedio (bolsa grande)",
    pallet: "Material de paletización",
}


export const PACKAGING_ROLE_LABEL_TO_KEY: Record<string, string> = {
    "empaque individual": "unit",
    unit: "unit",
    "empaque intermedio (bolsa grande)": "intermediate",
    "empaque intermedio": "intermediate",
    intermediate: "intermediate",
    "material de paletizacion": "pallet",
    pallet: "pallet",
}

export const MAX_PACKAGING_IMPORT_ROWS = 1000
