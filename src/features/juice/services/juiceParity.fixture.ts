import { JuiceConstantsValues } from "../constants/juice.constant"
import { JuicePhysicalInput, JuiceRecipeInput } from "./juiceCostLines"

// Architect-provided corrected Mode A inputs; no HLOOKUP/displayed-sheet totals.
export const parityRecipe: JuiceRecipeInput = {
    rawMaterials: [
        { rawMaterialId: 1, displayName: "NARANJA", percentage: 15, costPerLiter: "1.87391" },
        { rawMaterialId: 2, displayName: "PIÑA PRENSA", percentage: 42, costPerLiter: "0" },
        { rawMaterialId: 3, displayName: "ZANAHORIA", percentage: 43, costPerLiter: "0.62201" },
    ],
    spices: [{ spiceMaterialId: 1, displayName: "JENGIBRE POLVO", gramsPerLiter: "0.35", costPerGram: "0.028105154757" }],
}
export const parityPhysical: JuicePhysicalInput = {
    mlPerBottle: 354, bottlesPerCase: 6, casesPerPallet: 424,
    boxUnitCost: "0.3208", bottleUnitCost: "0.173689978", capUnitCost: "0.015125",
    stickerUnitCost: "0.14911439", stickerQuantityPerCase: 6,
    secondStickerUnitCost: 0, secondStickerQuantityPerCase: 6, marginPerCase: 2.4,
}
export const parityConstants: JuiceConstantsValues = {
    directLaborPerPound: 0.07, indirectLaborPerPound: 0.035, financialPerPound: 0, fixedPerPound: 0,
    electricityPerPound: 0.02, cleaningPerPound: 0.01, laboratoryPerPound: 0.01, hppPerPound: 0.045,
    palletizingPerContainer: 450, localCustomsPerContainer: 59, miamiCustomsPerContainer: 150,
    freightPerContainer: 5110, inOutPerContainer: 0, accesorialPerContainer: 0, storagePerContainer: 1320,
    logisticMovementPerContainer: 0, unexpectedRate: 0.02, tariffRate: 0.1, portFeeRate: 0.00125,
    salesmanCommissionRate: 0.065, distributorCommissionRate: 0.015, palletsPerContainer: 20,
}
