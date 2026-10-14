
// Carga masiva de Recetas de materias primas. Una fila por (Producto, Materia Prima), con su %.
export type ProductRawMaterialImportField =
    | "productSku"
    | "rawMaterialCode"
    | "percentage"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

// Aliases ya normalizados con normalizeImportText (minúsculas, sin acentos).
export const PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS: Record<ProductRawMaterialImportField, ImportColumnDef> = {
    productSku: { header: "SKU de una variante del producto", aliases: ["sku de una variante del producto", "sku", "codigo sku"] },
    rawMaterialCode: { header: "Código Materia Prima", aliases: ["codigo materia prima", "materia prima", "codigo mp"] },
    percentage: { header: "Porcentaje", aliases: ["porcentaje", "%", "percentage"] },
}

export const REQUIRED_PRODUCT_RAW_MATERIAL_IMPORT_FIELDS: ProductRawMaterialImportField[] = [
    "productSku",
    "rawMaterialCode",
    "percentage",
]

// Misma tolerancia que quoteService.MIX_PERCENTAGE_TOLERANCE y que el techo blando del admin
// (productRawMaterial.service.ts::RECIPE_PERCENTAGE_TOLERANCE).
export const RECIPE_PERCENTAGE_TOLERANCE = 0.5

export const MAX_PRODUCT_RAW_MATERIAL_IMPORT_ROWS = 5000
