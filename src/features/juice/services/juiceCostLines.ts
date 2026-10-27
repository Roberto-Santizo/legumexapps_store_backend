import Decimal from "decimal.js"
import { AppError } from "../../../shared/errors/AppError"
import { toDecimal, roundMoney } from "../../../shared/utils/money.util"
import { JUICE_POUNDS_PER_LITER } from "../constants/juice.constant"

type Numeric = number | string
export interface JuiceRecipeInput {
    rawMaterials: { rawMaterialId: number; displayName: string; percentage: Numeric; costPerLiter: Numeric }[]
    spices: { spiceMaterialId: number; displayName: string; gramsPerLiter: Numeric; costPerGram: Numeric }[]
}
export interface JuicePhysicalInput {
    mlPerBottle: Numeric
    bottlesPerCase: number
    casesPerPallet: number
    boxUnitCost: Numeric
    stickerUnitCost: Numeric
    stickerQuantityPerCase: Numeric
    secondStickerUnitCost: Numeric
    secondStickerQuantityPerCase: Numeric
    bottleUnitCost: Numeric
    capUnitCost: Numeric
}

function amount(value: Numeric, positive = false): Decimal {
    if ((typeof value !== "number" && typeof value !== "string") || value === "") throw new AppError(422, "errors.juice_invalid_cost_input")
    const result = toDecimal(value)
    if (!result.isFinite() || result.isNegative() || (positive && result.isZero())) {
        throw new AppError(422, "errors.juice_invalid_cost_input")
    }
    return result
}

// Keep Decimal throughout the calculation. Round quote amounts at the output boundary only;
// per-pound diagnostics retain precision so the recipe/conversion parity can be inspected.
export function buildJuiceCostLines(recipe: JuiceRecipeInput, physical: JuicePhysicalInput, quantity: number) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(physical.bottlesPerCase) || physical.bottlesPerCase <= 0) {
        throw new AppError(422, "errors.juice_invalid_cost_input")
    }
    const rawIds = new Set<number>()
    const liquidRows = recipe.rawMaterials.map(row => {
        if (rawIds.has(row.rawMaterialId)) throw new AppError(422, "errors.juice_invalid_recipe")
        rawIds.add(row.rawMaterialId)
        const percentage = amount(row.percentage, true)
        if (percentage.greaterThan(100)) throw new AppError(422, "errors.juice_invalid_recipe")
        return { ...row, contribution: percentage.div(100).times(amount(row.costPerLiter)) }
    })
    const percentage = recipe.rawMaterials.reduce((sum, row) => sum.plus(row.percentage), toDecimal(0))
    if (recipe.rawMaterials.length === 0 || !percentage.equals(100)) throw new AppError(422, "errors.juice_mix_incomplete")
    const spiceIds = new Set<number>()
    const spiceRows = recipe.spices.map(row => {
        if (spiceIds.has(row.spiceMaterialId)) throw new AppError(422, "errors.juice_invalid_recipe")
        spiceIds.add(row.spiceMaterialId)
        return { ...row, contribution: amount(row.gramsPerLiter, true).times(amount(row.costPerGram)) }
    })
    const liquidCostPerLiter = liquidRows.reduce((sum, row) => sum.plus(row.contribution), toDecimal(0))
    const spiceCostPerLiter = spiceRows.reduce((sum, row) => sum.plus(row.contribution), toDecimal(0))
    const rawCostPerLiter = liquidCostPerLiter.plus(spiceCostPerLiter)
    const rawCostPerPound = rawCostPerLiter.div(JUICE_POUNDS_PER_LITER)
    const poundsPerCase = amount(physical.mlPerBottle, true).div(1000).times(JUICE_POUNDS_PER_LITER).times(physical.bottlesPerCase)
    const lines: { key: string; cost: Decimal }[] = []
    const add = (key: string, cost: Decimal) => { lines.push({ key, cost }) }
    const packaging = (costPerCase: Decimal) => costPerCase.div(poundsPerCase)
    add("rawMaterial", liquidCostPerLiter.div(JUICE_POUNDS_PER_LITER))
    add("spices", spiceCostPerLiter.div(JUICE_POUNDS_PER_LITER))
    add("emptyBox", packaging(amount(physical.boxUnitCost)))
    add("sticker", packaging(amount(physical.stickerUnitCost).times(amount(physical.stickerQuantityPerCase))
        .plus(amount(physical.secondStickerUnitCost).times(amount(physical.secondStickerQuantityPerCase)))))
    add("bottles", packaging(amount(physical.bottleUnitCost).times(physical.bottlesPerCase)))
    add("caps", packaging(amount(physical.capUnitCost).times(physical.bottlesPerCase)))
    const total = lines.reduce((sum, row) => sum.plus(row.cost), toDecimal(0))
    const costPerCase = total.times(poundsPerCase)
    return {
        quantity, poundsPerCase: poundsPerCase.toNumber(), totalPounds: poundsPerCase.times(quantity).toNumber(),
        liquidCostPerLiter: liquidCostPerLiter.toNumber(), spiceCostPerLiter: spiceCostPerLiter.toNumber(),
        rawMaterialCostPerLiter: rawCostPerLiter.toNumber(), rawMaterialCostPerPound: rawCostPerPound.toNumber(),
        recipe: {
            rawMaterials: liquidRows.map(({ contribution, ...row }) => ({ ...row, contributionPerLiter: contribution.toNumber() })),
            spices: spiceRows.map(({ contribution, ...row }) => ({ ...row, contributionPerLiter: contribution.toNumber() })),
        },
        lines: lines.map(row => ({ key: row.key, costPerPound: row.cost.toNumber(), costPerCase: roundMoney(row.cost.times(poundsPerCase)), totalCost: roundMoney(row.cost.times(poundsPerCase).times(quantity)) })),
        totalCostPerPound: roundMoney(total), costPerCase: roundMoney(costPerCase), totalCost: roundMoney(costPerCase.times(quantity)),
    }
}
