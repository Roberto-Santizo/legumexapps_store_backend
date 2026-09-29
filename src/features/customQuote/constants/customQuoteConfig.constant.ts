// Configuración de "Cotizaciones a la medida" (World 2): listas de permitidos que el admin arma
// para que un representante pueda cotizar un producto que todavía no existe (sin SKU). Estas
// tablas NO forman parte del catálogo de productos definidos y nunca se leen desde
// quote.service.ts.

// Cómo se interpreta CustomQuotePackagingOption.quantity según el nivel del empaque (el nivel es
// el packagingRole del Packaging, nunca se guarda aparte):
//   - unit          -> "per_unit": cantidad por unidad (bolsa), igual que
//                      ProductVariantUnitMaterial.quantityPerUnit.
//   - pallet        -> "per_pallet": cantidad por palet, igual que
//                      ProductVariantPalletMaterial.quantityValue; o "per_box": cantidad por caja,
//                      que el motor multiplica por las cajas por palet de la presentación elegida.
//   - intermediate  -> sin cantidad: la línea es ceil(unidades / unitsPerIntermediatePackage) de la
//                      presentación, igual que en productos definidos.
export const CUSTOM_QUOTE_QUANTITY_BASES = ["per_unit", "per_pallet", "per_box"] as const
export type CustomQuoteQuantityBasis = (typeof CUSTOM_QUOTE_QUANTITY_BASES)[number]

export const CUSTOM_QUOTE_PACKAGING_LEVELS = ["unit", "intermediate", "pallet"] as const
export type CustomQuotePackagingLevel = (typeof CUSTOM_QUOTE_PACKAGING_LEVELS)[number]

export const ALLOWED_QUANTITY_BASES_BY_LEVEL: Record<CustomQuotePackagingLevel, readonly CustomQuoteQuantityBasis[]> = {
    unit: ["per_unit"],
    intermediate: [],
    pallet: ["per_pallet", "per_box"],
}
