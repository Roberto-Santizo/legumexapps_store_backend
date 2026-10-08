import Product from "../models/Product.model"
import ProductVariant from "../models/ProductVariant.model"

// Identificadores: trim + case-insensitive, sin eliminar acentos ni interpretar wildcards.
export function skuCodeKey(value: string): string {
    return value.trim().toLowerCase()
}

export async function loadProductsByVariantSku(): Promise<Map<string, Product>> {
    const variants = await ProductVariant.findAll({
        where: { isActive: true },
        include: [{ model: Product, as: "parentProduct", required: true, where: { isActive: true } }],
    })
    return new Map(variants.map(variant => [skuCodeKey(variant.skuCode), variant.parentProduct]))
}
