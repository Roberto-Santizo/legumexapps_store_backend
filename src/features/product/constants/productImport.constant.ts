
// Carga masiva de Productos base -- paso 1 de 4 del pipeline Productos → Recetas → Ingredientes →
// SKUs. Una fila por Producto; la imagen NUNCA viene por
// Excel (el producto se crea sin imagen y se sube después en su pantalla de edición).
export type ProductImportField =
    | "codigo"
    | "subCategory"
    | "category"
    | "client"
    | "displayName"
    | "displayNameEn"
    | "isOrganic"
    | "recipeType"
    | "additionalCostPerUnit"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

// Aliases ya normalizados con normalizeImportText (minúsculas, sin acentos).
export const PRODUCT_IMPORT_COLUMNS: Record<ProductImportField, ImportColumnDef> = {
    codigo: { header: "Código Producto", aliases: ["codigo producto", "codigo", "sku / numero de articulo", "sku", "numero de articulo"] },
    subCategory: { header: "Subcategoría", aliases: ["subcategoria", "sub categoria", "subcategory"] },
    category: { header: "Categoría", aliases: ["categoria", "category"] },
    client: { header: "Cliente", aliases: ["cliente", "client"] },
    displayName: { header: "Nombre del producto", aliases: ["nombre del producto", "nombre", "product name"] },
    displayNameEn: { header: "Nombre del producto (inglés)", aliases: ["nombre del producto (ingles)", "nombre (ingles)", "product name (english)"] },
    isOrganic: { header: "Orgánico", aliases: ["organico", "organic"] },
    recipeType: { header: "Tipo de receta", aliases: ["tipo de receta", "receta", "recipe type"] },
    additionalCostPerUnit: { header: "Costo adicional por unidad", aliases: ["costo adicional por unidad", "costo adicional", "additional cost per unit"] },
}

export const REQUIRED_PRODUCT_IMPORT_FIELDS: ProductImportField[] = [
    "codigo",
    "subCategory",
    "client",
    "displayName",
    "recipeType",
]

// "Tipo de receta" -> isCustomizable. Tokens ya normalizados (normalizeImportText).
export const FIXED_RECIPE_TOKENS = ["fija", "receta fija", "fixed", "fijo"]
export const CUSTOMIZABLE_RECIPE_TOKENS = ["personalizable", "customizable", "mezcla", "mix", "receta personalizable"]

export const MAX_PRODUCT_IMPORT_ROWS = 1000
