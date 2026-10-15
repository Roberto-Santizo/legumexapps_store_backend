import Decimal from "decimal.js"
import { AppError } from "../../../shared/errors/AppError"
import { roundMoney, toDecimal } from "../../../shared/utils/money.util"
import {
    COST_BASES_REQUIRING_POUNDS,
    TRANSFORMATION_STORAGE_DECIMALS,
    TransformationCostBasis,
    TransformationCostCategory,
    TransformationCurrency,
} from "../constants/rawMaterialTransformation.constant"

export interface TransformationCostInput {
    category: TransformationCostCategory
    conceptName: string
    amount: number | string
    currency: TransformationCurrency
    costBasis: TransformationCostBasis
    poundsPerUnit?: number | string | null
}

export interface TransformationCalculationInput {
    inputCostPerPound: number | string
    inputCurrency: TransformationCurrency
    freightPerPound: number | string
    freightCurrency: TransformationCurrency
    yieldPercentage: number | string
    // Quetzales por 1 USD, ingresado y guardado en cada transformación (no hay tipo de cambio global).
    exchangeRate: number | string
    costs: TransformationCostInput[]
}

export interface TransformationCostLineResult {
    costUsdPerProcessedPound: number
}

export interface TransformationCalculationResult {
    inputCostUsdPerPound: number
    freightUsdPerPound: number
    rawMaterialCostUsd: number
    directLaborCostUsd: number
    packagingCostUsd: number
    otherCostUsd: number
    processedCostUsd: number
    // Valor que se escribe en rawMaterials.costPerUnit (escala del catálogo, 4 decimales).
    catalogCostPerPound: number
    lines: TransformationCostLineResult[]
}

// Solo se redondea al guardar (12 decimales): los subtotales se calculan siempre con los valores
// completos, nunca con un intermedio ya redondeado.
const toStored = (value: Decimal): number => value.toDecimalPlaces(TRANSFORMATION_STORAGE_DECIMALS, Decimal.ROUND_HALF_UP).toNumber()

function toUsd(amount: Decimal, currency: TransformationCurrency, exchangeRate: Decimal): Decimal {
    return currency === "USD" ? amount : amount.dividedBy(exchangeRate)
}

function costPerProcessedPound(cost: TransformationCostInput, yieldFraction: Decimal, exchangeRate: Decimal): Decimal {
    const amountUsd = toUsd(toDecimal(cost.amount), cost.currency, exchangeRate)
    if (cost.costBasis === "per_processed_pound") return amountUsd
    if (cost.costBasis === "per_input_pound") return amountUsd.dividedBy(yieldFraction)
    const pounds = toDecimal(cost.poundsPerUnit)
    if (!pounds.isPositive() || pounds.isZero()) {
        throw new AppError(422, "errors.raw_material_transformation_pounds_per_unit_required", { concept: cost.conceptName })
    }
    return amountUsd.dividedBy(pounds)
}

// Costo procesado (USD/lb) = ((costo MP + flete) / rendimiento) + mano de obra + empaques + otros.
// Materia prima y flete son por libra de entrada; cada costo adicional se convierte a USD por libra
// procesada según su base. Es la única implementación de la fórmula: la vista previa, el guardado y
// el recálculo de transformaciones hermanas llaman a esta función.
export function calculateTransformation(input: TransformationCalculationInput): TransformationCalculationResult {
    const exchangeRate = toDecimal(input.exchangeRate)
    if (!exchangeRate.isPositive() || exchangeRate.isZero()) throw new AppError(422, "errors.raw_material_transformation_invalid_exchange_rate")
    const yieldPercentage = toDecimal(input.yieldPercentage)
    if (yieldPercentage.lessThanOrEqualTo(0) || yieldPercentage.greaterThan(100)) throw new AppError(422, "errors.raw_material_transformation_invalid_yield")
    const yieldFraction = yieldPercentage.dividedBy(100)

    const inputUsd = toUsd(toDecimal(input.inputCostPerPound), input.inputCurrency, exchangeRate)
    const freightUsd = toUsd(toDecimal(input.freightPerPound), input.freightCurrency, exchangeRate)
    const rawMaterialCost = inputUsd.plus(freightUsd).dividedBy(yieldFraction)

    const totals: Record<TransformationCostCategory, Decimal> = { direct_labor: new Decimal(0), packaging: new Decimal(0), other: new Decimal(0) }
    const lines = input.costs.map(cost => {
        if (!COST_BASES_REQUIRING_POUNDS.includes(cost.costBasis) && cost.poundsPerUnit != null) {
            throw new AppError(422, "errors.raw_material_transformation_pounds_per_unit_not_allowed", { concept: cost.conceptName })
        }
        const line = costPerProcessedPound(cost, yieldFraction, exchangeRate)
        totals[cost.category] = totals[cost.category].plus(line)
        return { costUsdPerProcessedPound: toStored(line) }
    })

    const processed = rawMaterialCost.plus(totals.direct_labor).plus(totals.packaging).plus(totals.other)
    return {
        inputCostUsdPerPound: toStored(inputUsd),
        freightUsdPerPound: toStored(freightUsd),
        rawMaterialCostUsd: toStored(rawMaterialCost),
        directLaborCostUsd: toStored(totals.direct_labor),
        packagingCostUsd: toStored(totals.packaging),
        otherCostUsd: toStored(totals.other),
        processedCostUsd: toStored(processed),
        catalogCostPerPound: roundMoney(processed),
        lines,
    }
}
