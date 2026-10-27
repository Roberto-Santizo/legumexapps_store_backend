
export type PackagingImportField = "displayNameEn" | "classification" | "code" | "displayName" | "packagingRole" | "materialType" | "unitCost"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const PACKAGING_IMPORT_COLUMNS: Record<PackagingImportField, ImportColumnDef> = {
    // Primera columna de la plantilla a propósito (ver buildPackagingImportTemplate) -- el
    // mapeo real de columnas es por nombre de encabezado (mapImportHeaders), no por posición.
    classification: { header: "Clasificación", aliases: ["clasificacion", "classification"] },
    code: { header: "Código", aliases: ["codigo", "código", "code"] },
    displayName: { header: "Nombre", aliases: ["nombre", "nombre (espanol)", "nombre espanol", "displayname"] },
    displayNameEn: { header: "Nombre (Inglés)", aliases: ["nombre (ingles)", "nombre ingles", "english name", "displaynameen"] },
    packagingRole: { header: "Rol del material", aliases: ["rol del material", "rol"] },
    materialType: { header: "Tipo de material", aliases: ["tipo de material", "material type"] },
    unitCost: { header: "Costo por unidad (USD)", aliases: ["costo por unidad (usd)", "costo por unidad (q)", "costo por unidad", "costo"] },
}

// "Código" is required per row only for specific materials; generic ones get a system code.
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

// Explicit import classifications, never inferred from Packaging labels/codes.
export const INITIAL_MATERIAL_TYPES = {
    INDIVIDUAL: { role: "unit", basis: "", quantity: 1 },
    INTERMEDIO: { role: "intermediate", basis: "", quantity: null },
    CAJA: { role: "pallet", basis: "per_box", quantity: 1 },
    ESQUINERO: { role: "pallet", basis: "per_pallet", quantity: 4 },
    TARIMA: { role: "pallet", basis: "per_pallet", quantity: 1 },
    STRETCH: { role: "pallet", basis: "per_pallet", quantity: 93.3 },
    "OTRO PALETIZACIÓN": { role: "pallet", basis: "", quantity: null },
} as const
