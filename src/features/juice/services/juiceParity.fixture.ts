import { JuicePhysicalInput, JuiceRecipeInput } from "./juiceCostLines"

// Corrected Mode A inputs supplied by the business; no HLOOKUP/displayed-sheet totals.
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
    secondStickerUnitCost: 0, secondStickerQuantityPerCase: 6,
}
