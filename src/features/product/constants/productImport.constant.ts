// Productos y variantes: una fila por SKU; grupo explícito, no por nombre.
export type ProductImportField =
    | "productGroup"
    | "skuCode"
    | "presentationLabel"
    | "boxesPerPallet"
    | "bagsPerBox"
    | "unitsPerIntermediatePackage"
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
    productGroup: { header: "Grupo de producto", aliases: ["grupo de producto", "product group"] },
    skuCode: { header: "SKU / Número de artículo", aliases: ["sku / numero de articulo", "sku", "sku code", "codigo sku"] },
    presentationLabel: { header: "Presentación", aliases: ["presentacion", "presentation"] },
    boxesPerPallet: { header: "Cajas por palet", aliases: ["cajas por palet", "cajas por pallet"] },
    bagsPerBox: { header: "Bolsas por caja", aliases: ["bolsas por caja", "unidades por caja"] },
    unitsPerIntermediatePackage: { header: "Unidades por empaque intermedio", aliases: ["unidades por empaque intermedio"] },
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
    "productGroup",
    "skuCode",
    "presentationLabel",
    "boxesPerPallet",
    "bagsPerBox",
    "subCategory",
    "client",
    "displayName",
    "recipeType",
]

// "Tipo de receta" -> isCustomizable. Tokens ya normalizados (normalizeImportText).
export const FIXED_RECIPE_TOKENS = ["fija", "receta fija", "fixed", "fijo"]
export const CUSTOMIZABLE_RECIPE_TOKENS = ["personalizable", "customizable", "mezcla", "mix", "receta personalizable"]

export const MAX_PRODUCT_IMPORT_ROWS = 5000
