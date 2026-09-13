// Carga masiva de SKUs/Variantes (2026-09-13) -- "forma larga": una fila por CADA material de la
// receta de empaque de un SKU (varias filas comparten el mismo Código SKU, igual que en los 3
// Excel de origen del negocio). No existe un shape "ancho" porque el número de materiales por SKU
// varía (1-7 en los datos reales) -- una fila por material evita columnas fijas que no alcanzarían
// para el caso de 7 materiales ni escalarían si algún día aparece un octavo.
export type ProductVariantImportField =
    | "productCodigo"
    | "skuCode"
    | "presentationLabel"
    | "boxesPerPallet"
    | "bagsPerBox"
    | "materialCode"
    | "quantity"

interface ImportColumnDef {
    header: string
    aliases: string[]
}

export const PRODUCT_VARIANT_IMPORT_COLUMNS: Record<ProductVariantImportField, ImportColumnDef> = {
    productCodigo: { header: "Código Producto", aliases: ["codigo producto", "código producto", "producto"] },
    skuCode: { header: "Código SKU", aliases: ["codigo sku", "código sku", "sku"] },
    presentationLabel: { header: "Presentación", aliases: ["presentacion", "presentación"] },
    boxesPerPallet: { header: "Cajas por palet", aliases: ["cajas por palet", "cajas por pallet"] },
    bagsPerBox: { header: "Bolsas por caja", aliases: ["bolsas por caja"] },
    materialCode: { header: "Código Material", aliases: ["codigo material", "código material", "material"] },
    // "Cantidad" tiene un significado distinto según el ROL del material de esa fila (resuelto
    // desde el catálogo de Empaques ya cargado, NUNCA re-declarado en esta plantilla): empaque
    // individual -> cuántas unidades de ese material lleva CADA bolsa/unidad de producto; empaque
    // intermedio -> cuántas unidades pequeñas caben en la bolsa/caja grande; material de
    // paletización -> cuántas unidades de ese material lleva CADA palet (para la caja que se
    // apila, esto normalmente es igual a "Cajas por palet"). Ver
    // productVariantImport.service.ts::resolveQuantityTarget.
    quantity: { header: "Cantidad", aliases: ["cantidad"] },
}

// Las 7 columnas son requeridas -- ninguna tiene un valor por defecto razonable (ver memoria del
// proyecto: campos que alimentan el cálculo nunca quedan opcionales con un fallback silencioso).
export const REQUIRED_PRODUCT_VARIANT_IMPORT_FIELDS: ProductVariantImportField[] = [
    "productCodigo",
    "skuCode",
    "presentationLabel",
    "boxesPerPallet",
    "bagsPerBox",
    "materialCode",
    "quantity",
]

export const MAX_PRODUCT_VARIANT_IMPORT_ROWS = 5000
