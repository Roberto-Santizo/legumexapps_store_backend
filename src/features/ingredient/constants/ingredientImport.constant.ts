
// Carga masiva del catálogo de Ingredientes (sal, azúcar, pimienta...). Sin columna de unidad de
// costo -- se fuerza a Libra server-side, igual que RawMaterial (ver ingredient.service.ts).
export type IngredientImportField =
    | "code"
    | "displayName"
    | "costPerUnit"
    | "displayNameEn"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const INGREDIENT_IMPORT_COLUMNS: Record<IngredientImportField, ImportColumnDef> = {
    code: { header: "Código", aliases: ["codigo", "código", "code"] },
    displayName: { header: "Nombre", aliases: ["nombre"] },
    costPerUnit: { header: "Costo por libra", aliases: ["costo por libra", "costo por unidad", "costo"] },
    displayNameEn: { header: "Nombre (inglés)", aliases: ["nombre (ingles)", "nombre ingles", "nombre en ingles"] },
}

export const REQUIRED_INGREDIENT_IMPORT_FIELDS: IngredientImportField[] = [
    "code",
    "displayName",
    "costPerUnit",
]

export const MAX_INGREDIENT_IMPORT_ROWS = 1000
