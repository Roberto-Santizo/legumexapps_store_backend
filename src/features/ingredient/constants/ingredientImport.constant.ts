
export type IngredientImportField =
    | "code"
    | "displayName"
    | "ingredientType"
    | "isOrganic"
    | "isMixable"
    | "costPerUnit"
    | "costUnitId"
    | "displayNameEn"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const INGREDIENT_IMPORT_COLUMNS: Record<IngredientImportField, ImportColumnDef> = {
    code: { header: "Código", aliases: ["codigo", "código", "code"] },
    displayName: { header: "Nombre", aliases: ["nombre"] },
    ingredientType: { header: "Tipo de ingrediente", aliases: ["tipo de ingrediente", "tipo"] },
    isOrganic: { header: "Es la variante orgánica (Sí/No)", aliases: ["es la variante organica (si/no)", "es la variante organica", "organico", "es organico"] },
    isMixable: { header: "Se puede mezclar (Sí/No)", aliases: ["se puede mezclar (si/no)", "se puede mezclar", "mezclable"] },
    costPerUnit: { header: "Costo por unidad", aliases: ["costo por unidad", "costo"] },
    costUnitId: { header: "Unidad de costo", aliases: ["unidad de costo", "unidad"] },
    displayNameEn: { header: "Nombre (inglés)", aliases: ["nombre (ingles)", "nombre ingles", "nombre en ingles"] },
}


export const REQUIRED_INGREDIENT_IMPORT_FIELDS: IngredientImportField[] = [
    "code",
    "displayName",
    "ingredientType",
    "costPerUnit",
    "costUnitId",
]


export const INGREDIENT_TYPE_LABELS: Record<string, string> = {
    fruit: "Fruta",
    vegetable: "Vegetal",
    pulp: "Pulpa",
    other: "Otro",
}


export const INGREDIENT_TYPE_LABEL_TO_KEY: Record<string, string> = {
    fruta: "fruit",
    fruit: "fruit",
    vegetal: "vegetable",
    vegetable: "vegetable",
    pulpa: "pulp",
    pulp: "pulp",
    otro: "other",
    other: "other",
}


export const INGREDIENT_IS_ORGANIC_DEFAULT = false
export const INGREDIENT_IS_MIXABLE_DEFAULT = true

export const MAX_INGREDIENT_IMPORT_ROWS = 1000
