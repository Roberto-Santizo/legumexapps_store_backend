import type { ContentLanguage } from "../../../shared/utils/translation.util"
import type { QuoteOrderIdentity } from "../../quoteOrder/schemas/quoteOrder.schema"
import type {
    AdjustmentLine,
    IngredientLine,
    IntermediateMaterialLine,
    PalletMaterialLine,
    PercentageCostLine,
    ProcessingCostLine,
    RawMaterialLine,
    TransportLine,
    UnitMaterialLine,
} from "./quoteCostLines"

// Resultado de un cálculo de cotización: lo produce el motor de productos definidos y los demás
// motores (a la medida, jugos) devuelven la misma forma de costos y breakdown.
export interface QuoteCalculation {
    productVariantId: number
    // null cuando no se mandó destinationId -- ver TransportLine.destinationId en quoteCostLines.ts.
    destinationId: number | null
    productDisplayName: string
    variantLabel: string | null
    requestedPallets: number
    totalUnits: number
    boxesPerPallet: number
    rawMaterialCost: number
    ingredientCost: number
    unitPackagingCost: number
    intermediatePackagingCost: number
    processingCostTotal: number
    palletMaterialCost: number
    percentageCostTotal: number
    transportCost: number
    adjustmentCost: number
    totalCost: number
    breakdown: {
        order?: QuoteOrderIdentity
        production?: { productId: number; skuCode: string; boxesPerPallet: number; bagsPerBox: number; netWeightGrams: number | null }
        rawMaterials: RawMaterialLine[]
        ingredients: IngredientLine[]
        unitMaterials: UnitMaterialLine[]
        // Array (no un único objeto o null) -- el nivel intermedio admite N filas fijas + N grupos
        // de opciones, igual que unit/pallet.
        intermediateMaterials: IntermediateMaterialLine[]
        processingCosts: ProcessingCostLine[]
        palletMaterials: PalletMaterialLine[]
        percentageCosts: PercentageCostLine[]
        transport: TransportLine
        adjustment: AdjustmentLine | null
        language: ContentLanguage
    }
}
