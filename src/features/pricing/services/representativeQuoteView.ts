import type { QuoteCalculation } from "./quoteCalculation"

// Vista del REPRESENTANTE de una cotización: lo que se cotiza (producto, cantidades, receta en %,
// empaques y logística), NUNCA un monto -- ni costos por línea, ni subtotales, ni el total. Los
// montos los revisa gerencia antes de definir el precio. Se arma con una lista explícita de campos
// permitidos (no borrando los de costo), así un costo agregado después al motor nunca se filtra solo.
// Costos adicionales, porcentajes, transporte y ajuste no tienen nada que no sea un monto: no viajan.

// production cambia de forma entre motores (los productos nuevos no tienen SKU): viaja tal cual.
type Breakdown<Production> = Omit<QuoteCalculation["breakdown"], "production"> & { production?: Production }

export function representativeBreakdown<Production>(breakdown: Breakdown<Production>) {
    return {
        ...(breakdown.order ? { order: breakdown.order } : {}),
        ...(breakdown.production ? { production: breakdown.production } : {}),
        rawMaterials: breakdown.rawMaterials.map(line => ({
            rawMaterialId: line.rawMaterialId,
            displayName: line.displayName,
            percentage: line.percentage,
            gramsPerUnit: line.gramsPerUnit,
            quantityUnit: line.quantityUnit,
            quantityPerUnit: line.quantityPerUnit,
            totalUnits: line.totalUnits,
        })),
        ingredients: breakdown.ingredients.map(line => ({
            ingredientId: line.ingredientId,
            displayName: line.displayName,
            quantityUnit: line.quantityUnit,
            grams: line.grams,
            referenceNetWeightGrams: line.referenceNetWeightGrams,
            gramsPerUnit: line.gramsPerUnit,
            quantityPerUnit: line.quantityPerUnit,
            totalUnits: line.totalUnits,
        })),
        unitMaterials: breakdown.unitMaterials.map(line => ({
            packagingId: line.packagingId,
            displayName: line.displayName,
            displayNameEn: line.displayNameEn,
            optionGroup: line.optionGroup,
            quantityPerUnit: line.quantityPerUnit,
            totalUnits: line.totalUnits,
        })),
        intermediateMaterials: breakdown.intermediateMaterials.map(line => ({
            packagingId: line.packagingId,
            displayName: line.displayName,
            displayNameEn: line.displayNameEn,
            optionGroup: line.optionGroup,
            unitsPerPackage: line.unitsPerPackage,
            totalUnits: line.totalUnits,
            packagesNeeded: line.packagesNeeded,
        })),
        palletMaterials: breakdown.palletMaterials.map(line => ({
            packagingId: line.packagingId,
            displayName: line.displayName,
            displayNameEn: line.displayNameEn,
            optionGroup: line.optionGroup,
            quantityPerPallet: line.quantityPerPallet,
            requestedPallets: line.requestedPallets,
        })),
        language: breakdown.language,
    }
}

// Línea de producto definido (o jugo vinculado) tal como la recibe el representante; con `id` y
// `createdAt` cuando ya se guardó.
export function representativeQuoteView(calculation: QuoteCalculation & { id?: number; createdAt?: Date }) {
    return {
        ...(calculation.id !== undefined ? { id: calculation.id } : {}),
        ...(calculation.createdAt !== undefined ? { createdAt: calculation.createdAt } : {}),
        productVariantId: calculation.productVariantId,
        destinationId: calculation.destinationId,
        productDisplayName: calculation.productDisplayName,
        variantLabel: calculation.variantLabel,
        requestedPallets: calculation.requestedPallets,
        totalUnits: calculation.totalUnits,
        boxesPerPallet: calculation.boxesPerPallet,
        breakdown: representativeBreakdown(calculation.breakdown),
    }
}
