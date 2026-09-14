
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
    quantity: { header: "Cantidad", aliases: ["cantidad"] },
}


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
