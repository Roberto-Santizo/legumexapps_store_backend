
// Carga masiva de Ingredientes por producto -- paso 3 (opcional) de 4 del pipeline Productos →
// Recetas → Ingredientes → SKUs. Una fila por (Producto, Ingrediente).
export type ProductIngredientImportField =
    | "productCodigo"
    | "ingredientCode"
    | "grams"
    | "referenceNetWeightGrams"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

// Aliases ya normalizados con normalizeImportText (minúsculas, sin acentos).
export const PRODUCT_INGREDIENT_IMPORT_COLUMNS: Record<ProductIngredientImportField, ImportColumnDef> = {
    productCodigo: { header: "Código Producto", aliases: ["codigo producto", "producto"] },
    ingredientCode: { header: "Código Ingrediente", aliases: ["codigo ingrediente", "ingrediente"] },
    grams: { header: "Gramos", aliases: ["gramos", "g", "grams"] },
    referenceNetWeightGrams: {
        header: "Peso de referencia (g)",
        aliases: ["peso de referencia (g)", "peso de referencia", "peso referencia", "reference weight"]
    },
}

export const REQUIRED_PRODUCT_INGREDIENT_IMPORT_FIELDS: ProductIngredientImportField[] = [
    "productCodigo",
    "ingredientCode",
    "grams",
    "referenceNetWeightGrams",
]

export const MAX_PRODUCT_INGREDIENT_IMPORT_ROWS = 5000
