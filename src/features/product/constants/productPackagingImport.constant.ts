import { ImportColumnDef } from "../../../shared/utils/excelImport.util"

export const PRODUCT_PACKAGING_IMPORT_COLUMNS = {
    skuCode: { header: "CÓDIGO SKU", aliases: ["codigo sku", "sku", "sku code"] },
    packagingCode: { header: "CÓDIGO MP", aliases: ["codigo mp", "packaging code", "material code"] },
    group: { header: "GRUPO DE OPCIONES", aliases: ["grupo de opciones", "option group"] },
    isDefault: { header: "PREDETERMINADO", aliases: ["predeterminado", "default"] },
    quantityBasis: { header: "BASE DE CANTIDAD", aliases: ["base de cantidad", "quantity basis"] },
    quantity: { header: "CANTIDAD", aliases: ["cantidad", "quantity"] },
    materialName: { header: "NOMBRE MP", aliases: ["nombre mp", "material name"] },
    unitCost: { header: "COSTO POR UNIDAD (USD)", aliases: ["costo por unidad (usd)", "unit cost (usd)"] },
} satisfies Record<string, ImportColumnDef>
export type ProductPackagingImportField = keyof typeof PRODUCT_PACKAGING_IMPORT_COLUMNS
export const MAX_PRODUCT_PACKAGING_IMPORT_ROWS = 1000
