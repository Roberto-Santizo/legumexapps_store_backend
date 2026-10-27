export const INITIAL_PACKAGING_SHEET = "Materiales de Empaque"
export const INITIAL_PRODUCT_SHEET = "Productos y Variantes"
export const INITIAL_PACKAGING_COLUMNS = {
    skuCode: { header: "SKU / NÚMERO DE ARTÍCULO", aliases: ["sku / numero de articulo", "sku", "codigo sku"] },
    packagingCode: { header: "CÓDIGO MP", aliases: ["codigo mp", "packaging code"] },
    materialType: { header: "TIPO DE MATERIAL", aliases: ["tipo de material", "material type"] },
    group: { header: "GRUPO DE OPCIONES", aliases: ["grupo de opciones", "option group"] },
    isDefault: { header: "PREDETERMINADO", aliases: ["predeterminado", "default"] },
    basis: { header: "FORMA DE CONSUMO", aliases: ["forma de consumo", "consumption basis"] },
    quantity: { header: "CANTIDAD", aliases: ["cantidad", "quantity"] },
}

export { INITIAL_MATERIAL_TYPES } from "../../packaging/constants/packagingImport.constant"
