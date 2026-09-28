
export type ProductVariantImportField =
    | "productCodigo"
    | "presentationLabel"
    | "boxesPerPallet"
    | "bagsPerBox"
    | "materialCode"
    | "quantity"
    | "optionGroup"
    | "isDefault"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const PRODUCT_VARIANT_IMPORT_COLUMNS: Record<ProductVariantImportField, ImportColumnDef> = {
    productCodigo: { header: "Código Producto", aliases: ["codigo producto", "código producto", "producto"] },
    presentationLabel: { header: "Presentación", aliases: ["presentacion", "presentación"] },
    boxesPerPallet: { header: "Cajas por palet", aliases: ["cajas por palet", "cajas por pallet"] },
    bagsPerBox: { header: "Bolsas por caja", aliases: ["bolsas por caja"] },
    materialCode: { header: "Código Material", aliases: ["codigo material", "código material", "material"] },
    quantity: { header: "Cantidad", aliases: ["cantidad"] },
    // Grupos de opciones -- columnas OPCIONALES: un archivo sin
    // ellas sigue importando cada material como fila fija, igual que antes. Aliases ya
    // normalizados con normalizeImportText (minúsculas, sin acentos).
    optionGroup: { header: "Grupo", aliases: ["grupo", "grupo de opciones", "option group", "group"] },
    isDefault: { header: "Predeterminado", aliases: ["predeterminado", "por defecto", "default"] },
}


export const REQUIRED_PRODUCT_VARIANT_IMPORT_FIELDS: ProductVariantImportField[] = [
    "productCodigo",
    "presentationLabel",
    "boxesPerPallet",
    "bagsPerBox",
    "materialCode",
    "quantity",
]

export const MAX_PRODUCT_VARIANT_IMPORT_ROWS = 5000

// Mismo tope que optionGroup en los schemas de material (z.string().max(60)) y la columna
// STRING(60) de los tres modelos ProductVariant*Material.
export const MAX_PRODUCT_VARIANT_IMPORT_OPTION_GROUP_LENGTH = 60

// Receta completa para poder crear un SKU: misma tolerancia que
// quoteService.MIX_PERCENTAGE_TOLERANCE al exigir que una receta fija sume 100.
export const RECIPE_COMPLETENESS_TOLERANCE = 0.5
