
// Sin columna de unidad de costo: la libra se fija en el servidor en cada import.
export type RawMaterialImportField =
    | "code"
    | "displayName"
    | "ingredientType"
    | "isOrganic"
    | "isMixable"
    | "costPerUnit"
    | "displayNameEn"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const RAW_MATERIAL_IMPORT_COLUMNS: Record<RawMaterialImportField, ImportColumnDef> = {
    code: { header: "Código", aliases: ["codigo", "código", "code"] },
    displayName: { header: "Nombre", aliases: ["nombre"] },
    ingredientType: { header: "Tipo de materia prima", aliases: ["tipo de materia prima", "tipo de ingrediente", "tipo"] },
    isOrganic: { header: "Es la variante orgánica (Sí/No)", aliases: ["es la variante organica (si/no)", "es la variante organica", "organico", "es organico"] },
    isMixable: { header: "Se puede mezclar (Sí/No)", aliases: ["se puede mezclar (si/no)", "se puede mezclar", "mezclable"] },
    costPerUnit: { header: "Costo por libra", aliases: ["costo por libra", "costo por unidad", "costo"] },
    displayNameEn: { header: "Nombre (inglés)", aliases: ["nombre (ingles)", "nombre ingles", "nombre en ingles"] },
}


export const REQUIRED_RAW_MATERIAL_IMPORT_FIELDS: RawMaterialImportField[] = [
    "code",
    "displayName",
    "ingredientType",
    "costPerUnit",
]


export const RAW_MATERIAL_TYPE_LABELS: Record<string, string> = {
    fruit: "Fruta",
    vegetable: "Vegetal",
    pulp: "Pulpa",
    other: "Otro",
}


export const RAW_MATERIAL_TYPE_LABEL_TO_KEY: Record<string, string> = {
    fruta: "fruit",
    fruit: "fruit",
    vegetal: "vegetable",
    vegetable: "vegetable",
    pulpa: "pulp",
    pulp: "pulp",
    otro: "other",
    other: "other",
}


export const RAW_MATERIAL_IS_ORGANIC_DEFAULT = false
export const RAW_MATERIAL_IS_MIXABLE_DEFAULT = true

export const MAX_RAW_MATERIAL_IMPORT_ROWS = 1000
