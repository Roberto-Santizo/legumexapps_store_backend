import Decimal from "decimal.js"
import { AppError } from "../../../shared/errors/AppError"
import { toDecimal, roundMoney } from "../../../shared/utils/money.util"
import { JUICE_POUNDS_PER_LITER, JUICE_PACKAGING_RECOVERY_FACTOR, JUICE_CONSTANT_FIELDS, JuiceConstantsValues } from "../constants/juice.constant"

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
    marginPerCase: Numeric
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
export function buildJuiceCostLines(recipe: JuiceRecipeInput, physical: JuicePhysicalInput,
    constants: JuiceConstantsValues, pricePerPound: Numeric, quantity: number) {
    const price = amount(pricePerPound, true)
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new AppError(422, "errors.juice_invalid_cost_input")
    for (const key of JUICE_CONSTANT_FIELDS) amount(constants[key])
    for (const value of [physical.bottlesPerCase, physical.casesPerPallet, constants.palletsPerContainer]) {
        if (!Number.isSafeInteger(value) || value <= 0) throw new AppError(422, "errors.juice_invalid_cost_input")
    }
    for (const key of ["unexpectedRate", "tariffRate", "portFeeRate", "salesmanCommissionRate", "distributorCommissionRate"] as const) {
        if (constants[key] > 1) throw new AppError(422, "errors.juice_invalid_cost_input")
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
    const casesPerContainer = toDecimal(physical.casesPerPallet).times(constants.palletsPerContainer)
    const poundsPerContainer = casesPerContainer.times(poundsPerCase)
    const lines: { key: string; cost: Decimal }[] = []
    const add = (key: string, cost: Decimal) => { lines.push({ key, cost }) }
    const packaging = (costPerCase: Decimal) => costPerCase.div(JUICE_PACKAGING_RECOVERY_FACTOR).div(poundsPerCase).negated()
    const container = (total: number) => amount(total).div(poundsPerContainer).negated()
    const sum = (rows: typeof lines) => rows.reduce((total, row) => total.plus(row.cost), toDecimal(0))
    add("rawMaterial", rawCostPerPound.negated())
    add("emptyBox", packaging(amount(physical.boxUnitCost)))
    add("sticker", packaging(amount(physical.stickerUnitCost).times(amount(physical.stickerQuantityPerCase))
        .plus(amount(physical.secondStickerUnitCost).times(amount(physical.secondStickerQuantityPerCase)))))
    add("bottles", packaging(amount(physical.bottleUnitCost).times(physical.bottlesPerCase)))
    add("caps", packaging(amount(physical.capUnitCost).times(physical.bottlesPerCase)))
    for (const key of ["directLabor", "indirectLabor", "financial", "fixed", "electricity", "cleaning", "laboratory"] as const) {
        add(key, amount(constants[`${key}PerPound`]).negated())
    }
    add("palletizing", container(constants.palletizingPerContainer))
    add("localClearing", container(constants.localCustomsPerContainer))
    add("unexpected", price.times(constants.unexpectedRate).negated())
    add("hpp", amount(constants.hppPerPound).negated())
    const tariffBase = sum(lines)
    const exteriorStart = lines.length
    add("tariff", tariffBase.times(constants.tariffRate))
    add("containerFreight", container(constants.freightPerContainer))
    add("miamiClearing", container(constants.miamiCustomsPerContainer))
    add("inOut", container(constants.inOutPerContainer))
    add("accesorial", container(constants.accesorialPerContainer))
    add("storage", container(constants.storagePerContainer))
    add("logisticMovement", container(constants.logisticMovementPerContainer))
    add("portFee", price.times(constants.portFeeRate).negated())
    const exteriorBeforeCommission = sum(lines.slice(exteriorStart))
    add("salesmanCommission", price.times(constants.salesmanCommissionRate).negated())
    const distributor = price.times(constants.distributorCommissionRate).negated()
    add("distributorCommission", distributor)
    const exterior = exteriorBeforeCommission.plus(distributor)
    const total = sum(lines)
    const costPerCase = total.times(poundsPerCase)
    const marginPerCase = amount(physical.marginPerCase)
    const pricePerCase = costPerCase.abs().plus(marginPerCase)
    const grossMargin = price.plus(total)
    const exworksCostPerCase = total.minus(exterior).times(poundsPerCase)
    const exworksPricePerCase = price.plus(exterior).times(poundsPerCase)
    return {
        quantity,
        poundsPerCase: poundsPerCase.toNumber(), casesPerContainer: casesPerContainer.toNumber(),
        poundsPerContainer: poundsPerContainer.toNumber(), totalPounds: poundsPerCase.times(quantity).toNumber(),
        inputPricePerPound: price.toNumber(), marginPerCase: marginPerCase.toNumber(),
        liquidCostPerLiter: liquidCostPerLiter.toNumber(), spiceCostPerLiter: spiceCostPerLiter.toNumber(),
        rawMaterialCostPerLiter: rawCostPerLiter.toNumber(), rawMaterialCostPerPound: rawCostPerPound.toNumber(),
        recipe: {
            rawMaterials: liquidRows.map(({ contribution, ...row }) => ({ ...row, contributionPerLiter: contribution.toNumber() })),
            spices: spiceRows.map(({ contribution, ...row }) => ({ ...row, contributionPerLiter: contribution.toNumber() })),
        },
        lines: lines.map(row => ({ key: row.key, costPerPound: row.cost.isZero() ? 0 : row.cost.toNumber(), costPerCase: roundMoney(row.cost.times(poundsPerCase)) || 0, totalCost: roundMoney(row.cost.times(poundsPerCase).times(quantity)) || 0 })),
        tariffBasePerPound: tariffBase.toNumber(), exteriorCostPerPound: exterior.toNumber(),
        totalCostPerPound: roundMoney(total), grossMarginPerPound: roundMoney(grossMargin),
        grossMarginRate: grossMargin.div(price).toNumber(),
        costPerCase: roundMoney(costPerCase), pricePerCase: roundMoney(pricePerCase),
        pricePerPound: roundMoney(pricePerCase.div(poundsPerCase)),
        exworksCostPerCase: roundMoney(exworksCostPerCase), exworksPricePerCase: roundMoney(exworksPricePerCase),
        totalCost: roundMoney(costPerCase.times(quantity)), totalPrice: roundMoney(pricePerCase.times(quantity)),
        totalMargin: roundMoney(marginPerCase.times(quantity)),
    }
}
