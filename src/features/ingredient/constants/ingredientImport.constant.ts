// Única fuente de verdad para la carga masiva de Ingredientes (importar Excel + plantilla
// descargable) -- mismo diseño que packagingImport.constant.ts (ver esa entrada de memoria del
// proyecto), solo cambian las columnas/validaciones porque el catálogo es distinto.

export type IngredientImportField =
    | "displayName"
    | "ingredientType"
    | "isOrganic"
    | "isMixable"
    | "costPerUnit"
    | "costUnitId"
    | "displayNameEn"

interface ImportColumnDef {
    header: string
    // Encabezados alternativos aceptados (ya normalizados: trim + minúsculas + sin acentos, ver
    // normalizeImportText en shared/utils/excelImport.util.ts).
    aliases: string[]
}

export const INGREDIENT_IMPORT_COLUMNS: Record<IngredientImportField, ImportColumnDef> = {
    displayName: { header: "Nombre", aliases: ["nombre"] },
    ingredientType: { header: "Tipo de ingrediente", aliases: ["tipo de ingrediente", "tipo"] },
    isOrganic: { header: "Es la variante orgánica (Sí/No)", aliases: ["es la variante organica (si/no)", "es la variante organica", "organico", "es organico"] },
    isMixable: { header: "Se puede mezclar (Sí/No)", aliases: ["se puede mezclar (si/no)", "se puede mezclar", "mezclable"] },
    costPerUnit: { header: "Costo por unidad", aliases: ["costo por unidad", "costo"] },
    costUnitId: { header: "Unidad de costo", aliases: ["unidad de costo", "unidad"] },
    displayNameEn: { header: "Nombre (inglés)", aliases: ["nombre (ingles)", "nombre ingles", "nombre en ingles"] },
}

// isOrganic/isMixable tienen default de negocio (false/true respectivamente, ver
// Ingredient.model.ts) si la celda queda vacía -- no son obligatorios. displayNameEn es
// traducción opcional (igual que en el formulario normal, ver ingredient.schema.ts).
export const REQUIRED_INGREDIENT_IMPORT_FIELDS: IngredientImportField[] = [
    "displayName",
    "ingredientType",
    "costPerUnit",
    "costUnitId",
]

// Etiquetas en español que ve el admin en el dropdown del formulario normal
// (ingredientForm.component.tsx) -- se reusan tal cual en la plantilla descargable.
export const INGREDIENT_TYPE_LABELS: Record<string, string> = {
    fruit: "Fruta",
    vegetable: "Vegetal",
    pulp: "Pulpa",
    other: "Otro",
}

// Texto libre -> key interna del enum. Acepta tanto el label en español como la key interna en
// inglés. Las claves de este mapa ya están normalizadas (ver normalizeImportText).
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

// Booleanos por defecto cuando la celda queda vacía -- mismo default que Ingredient.model.ts
// (isOrganic=false, isMixable=true), para que "dejar la celda en blanco" en el Excel produzca
// exactamente el mismo resultado que dejar el checkbox sin marcar/marcado en el form normal.
export const INGREDIENT_IS_ORGANIC_DEFAULT = false
export const INGREDIENT_IS_MIXABLE_DEFAULT = true

// Tope defensivo de filas por archivo -- mismo criterio que MAX_PACKAGING_IMPORT_ROWS.
export const MAX_INGREDIENT_IMPORT_ROWS = 1000
