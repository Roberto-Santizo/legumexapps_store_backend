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

// Explicit import classifications, never inferred from Packaging labels/codes.
export const INITIAL_MATERIAL_TYPES = {
    INDIVIDUAL: { role: "unit", basis: "", quantity: 1 },
    INTERMEDIO: { role: "intermediate", basis: "", quantity: null },
    CAJA: { role: "pallet", basis: "per_box", quantity: 1 },
    ESQUINERO: { role: "pallet", basis: "per_pallet", quantity: 4 },
    TARIMA: { role: "pallet", basis: "per_pallet", quantity: 1 },
    STRETCH: { role: "pallet", basis: "per_pallet", quantity: 93.3 },
    "OTRO PALETIZACIÓN": { role: "pallet", basis: "", quantity: null },
} as const
