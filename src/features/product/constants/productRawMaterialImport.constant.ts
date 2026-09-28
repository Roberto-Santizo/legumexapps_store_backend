
// Carga masiva de Recetas de materias primas -- paso 2 de 4 del pipeline Productos → Recetas →
// Ingredientes → SKUs. Una fila por (Producto, Materia Prima). El tipo de receta
// NUNCA se re-declara acá: sale del Product.isCustomizable ya creado en el paso 1.
export type ProductRawMaterialImportField =
    | "productCodigo"
    | "rawMaterialCode"
    | "percentage"
    | "minPercentage"
    | "maxPercentage"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

// Aliases ya normalizados con normalizeImportText (minúsculas, sin acentos).
export const PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS: Record<ProductRawMaterialImportField, ImportColumnDef> = {
    productCodigo: { header: "Código Producto", aliases: ["codigo producto", "producto"] },
    rawMaterialCode: { header: "Código Materia Prima", aliases: ["codigo materia prima", "materia prima", "codigo mp"] },
    percentage: { header: "Porcentaje", aliases: ["porcentaje", "%", "percentage"] },
    minPercentage: { header: "% mínimo", aliases: ["% minimo", "porcentaje minimo", "minimo", "min %"] },
    maxPercentage: { header: "% máximo", aliases: ["% maximo", "porcentaje maximo", "maximo", "max %"] },
}

export const REQUIRED_PRODUCT_RAW_MATERIAL_IMPORT_FIELDS: ProductRawMaterialImportField[] = [
    "productCodigo",
    "rawMaterialCode",
]

// Misma tolerancia que quoteService.MIX_PERCENTAGE_TOLERANCE y que el techo blando del admin
// (productRawMaterial.service.ts::FIXED_RECIPE_PERCENTAGE_TOLERANCE).
export const RECIPE_PERCENTAGE_TOLERANCE = 0.5

export const MAX_PRODUCT_RAW_MATERIAL_IMPORT_ROWS = 5000
