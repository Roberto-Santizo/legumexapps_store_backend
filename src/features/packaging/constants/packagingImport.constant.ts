// Única fuente de verdad para la carga masiva de Empaques (importar Excel + plantilla
// descargable) -- mismo principio que unitCatalog.ts: un solo lugar a mantener sincronizado
// en vez de que el parser y el generador de plantilla diverjan con el tiempo.

export type PackagingImportField = "displayName" | "packagingRole" | "packagingMaterial" | "unitCost"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const PACKAGING_IMPORT_COLUMNS: Record<PackagingImportField, ImportColumnDef> = {
    displayName: { header: "Nombre", aliases: ["nombre"] },
    packagingRole: { header: "Rol del material", aliases: ["rol del material", "rol"] },
    packagingMaterial: { header: "Material", aliases: ["material"] },
    unitCost: { header: "Costo por unidad (Q)", aliases: ["costo por unidad (q)", "costo por unidad", "costo"] },
}


export const REQUIRED_PACKAGING_IMPORT_FIELDS: PackagingImportField[] = ["displayName", "packagingRole", "unitCost"]

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
