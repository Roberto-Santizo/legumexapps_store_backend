import { representativeQuoteView } from "./representativeQuoteView"
import type { QuoteCalculation } from "./quoteCalculation"

// Cálculo de producto definido con montos en cada nivel: materia prima, ingrediente, los tres niveles
// de empaque, costo por peso, porcentaje, transporte y ajuste.
const calculation: QuoteCalculation = {
    productVariantId: 10, destinationId: 3, productDisplayName: "Piña IQF", variantLabel: "PIN-1 · 1 lb", requestedPallets: 2, totalUnits: 200, boxesPerPallet: 10,
    rawMaterialCost: 100, ingredientCost: 4, unitPackagingCost: 20, intermediatePackagingCost: 6, processingCostTotal: 50, palletMaterialCost: 8,
    percentageCostTotal: 9.4, transportCost: 300, adjustmentCost: 10, totalCost: 507.4,
    breakdown: {
        order: { id: "72db466a-e594-48b7-9864-128b4b305b08", clientName: "Walmart", clientId: 11 },
        production: { productId: 5, skuCode: "PIN-1", boxesPerPallet: 10, bagsPerBox: 10, netWeightGrams: 453.59237 },
        rawMaterials: [{ rawMaterialId: 1, code: "MP-1", percentage: 100, gramsPerUnit: 453.59237, quantityUnit: "LIBRA", displayName: "Piña", unitCost: 0.5, quantityPerUnit: 1, totalUnits: 200, lineTotal: 100 }],
        ingredients: [{ ingredientId: 7, code: "ING-7", quantityUnit: "GRAMO", displayName: "Sal", grams: 2, referenceNetWeightGrams: 453.59237, gramsPerUnit: 2, unitCost: 0.01, quantityPerUnit: 2, totalUnits: 200, lineTotal: 4 }],
        unitMaterials: [{ packagingId: 20, code: "BOL-1", displayName: "Bolsa", displayNameEn: "Bag", optionGroup: "Bolsa", unitCost: 0.1, quantityPerUnit: 1, totalUnits: 200, lineTotal: 20 }],
        intermediateMaterials: [{ packagingId: 30, code: "SAC-1", displayName: "Saco", displayNameEn: null, optionGroup: null, unitCost: 3, unitsPerPackage: 100, totalUnits: 200, packagesNeeded: 2, lineTotal: 6 }],
        processingCosts: [{ processingCostId: 1, displayName: "Mano de obra", value: 0.25, totalWeightPounds: 200, lineTotal: 50 }],
        palletMaterials: [{ packagingId: 40, code: "CAJ-1", displayName: "Caja", displayNameEn: "Box", optionGroup: null, unitCost: 0.4, quantityPerPallet: 10, requestedPallets: 2, lineTotal: 8 }],
        percentageCosts: [{ processingCostId: 2, displayName: "Administración", value: 5, baseAmount: 188, lineTotal: 9.4 }],
        transport: { destinationId: 3, displayName: "Puerto Quetzal", baseCost: 300 },
        adjustment: { unitCost: 0.05, totalUnits: 200, lineTotal: 10 },
        language: "es",
    },
}

const amountPattern = /cost|lineTotal|baseAmount|^value$|totalWeightPounds/i
function amountKeys(value: unknown, path = ""): string[] {
    if (!value || typeof value !== "object") return []
    return Object.entries(value).flatMap(([key, child]) => [...(amountPattern.test(key) ? [`${path}${key}`] : []), ...amountKeys(child, `${path}${key}.`)])
}

describe("representativeQuoteView", () => {
    it("no deja ningún monto: ni totales, ni subtotales, ni costos por línea, ni costos adicionales, transporte o ajuste", () => {
        const view = representativeQuoteView(calculation)
        expect(amountKeys(view)).toEqual([])
        expect(JSON.stringify(view)).not.toMatch(/Mano de obra|Administración|Puerto Quetzal/)
        expect(view.breakdown).not.toHaveProperty("processingCosts")
        expect(view.breakdown).not.toHaveProperty("percentageCosts")
        expect(view.breakdown).not.toHaveProperty("transport")
        expect(view.breakdown).not.toHaveProperty("adjustment")
    })

    it("conserva lo que se cotiza: producto, cantidades, receta, empaques, logística y pedido", () => {
        const view = representativeQuoteView({ ...calculation, id: 9, createdAt: new Date("2026-10-28T12:00:00Z") })
        expect(view).toMatchObject({ id: 9, productVariantId: 10, productDisplayName: "Piña IQF", variantLabel: "PIN-1 · 1 lb", requestedPallets: 2, totalUnits: 200, boxesPerPallet: 10 })
        expect(view.breakdown.order).toEqual(calculation.breakdown.order)
        expect(view.breakdown.production).toEqual(calculation.breakdown.production)
        expect(view.breakdown.rawMaterials).toEqual([{ rawMaterialId: 1, displayName: "Piña", percentage: 100, gramsPerUnit: 453.59237, quantityUnit: "LIBRA", quantityPerUnit: 1, totalUnits: 200 }])
        expect(view.breakdown.ingredients[0]).toMatchObject({ ingredientId: 7, displayName: "Sal", gramsPerUnit: 2 })
        expect(view.breakdown.unitMaterials[0]).toEqual({ packagingId: 20, displayName: "Bolsa", displayNameEn: "Bag", optionGroup: "Bolsa", quantityPerUnit: 1, totalUnits: 200 })
        expect(view.breakdown.intermediateMaterials[0]).toMatchObject({ packagingId: 30, unitsPerPackage: 100, packagesNeeded: 2 })
        expect(view.breakdown.palletMaterials[0]).toMatchObject({ packagingId: 40, displayName: "Caja", quantityPerPallet: 10, requestedPallets: 2 })
        expect(view.breakdown.language).toBe("es")
    })

    it("no inventa id ni createdAt para un cálculo que no se guardó", () => {
        const view = representativeQuoteView(calculation)
        expect(view).not.toHaveProperty("id")
        expect(view).not.toHaveProperty("createdAt")
    })
})
