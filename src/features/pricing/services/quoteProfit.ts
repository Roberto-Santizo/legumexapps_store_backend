import Decimal from "decimal.js"
import { getUnitCatalogEntry } from "../../unit/constants/unitCatalog"
import { AppError } from "../../../shared/errors/AppError"
import { roundMoney, sumMoney, toDecimal } from "../../../shared/utils/money.util"

// Ganancia por libra que define gerencia al revisar una cotización. Se calcula DESPUÉS del costo y
// fuera de él: nunca entra en la base de los costos porcentuales ni modifica totalCost (el costo
// congelado que gerencia revisó); el precio final es costo + ganancia. Matemática compartida por
// productos definidos, productos nuevos y jugos: recibe valores planos (costo, peso neto, unidades),
// nunca una Quote ni un snapshot.

const GRAMS_PER_POUND = getUnitCatalogEntry("pound")!.baseFactor

// Mismos decimales que cualquier monto del cotizador (MONEY_DECIMALS en money.util.ts).
const PROFIT_PER_POUND_DECIMALS = 4

// Tope de negocio (USD por libra, 2026-10-28): atrapa errores de tecleo como 25 en lugar de 0.25.
export const MAX_PROFIT_PER_POUND = 5

export interface ProfitLineInput {
    // Costo total congelado de la línea (Quote.totalCost / CustomQuote.totalCost; DECIMAL llega como string).
    totalCost: number | string
    // Peso neto por unidad de la presentación, en gramos (null en snapshots antiguos que no lo guardaron).
    netWeightGrams: number | string | null | undefined
    totalUnits: number
}

export interface ProfitLine {
    netPounds: number
    profitPerPound: number
    profitTotal: number
    finalPrice: number
}

// Monto por libra: número finito entre 0 (vender a costo) y el tope, con a lo sumo 4 decimales.
// Nunca se redondea en silencio un valor que escribió gerencia.
export function parseProfitPerPound(value: number | string): Decimal {
    const invalid = () => new AppError(422, "errors.profit_per_pound_invalid", { max: MAX_PROFIT_PER_POUND })
    let amount: Decimal
    try { amount = new Decimal(value) } catch { throw invalid() }
    if (!amount.isFinite() || amount.isNegative() || amount.gt(MAX_PROFIT_PER_POUND) || amount.decimalPlaces() > PROFIT_PER_POUND_DECIMALS) {
        throw invalid()
    }
    return amount
}

// Libras netas de producto terminado: peso neto por unidad × unidades (la misma base que los costos
// per_weight). Sin peso neto no hay ganancia por libra posible: se rechaza, nunca se asume 0.
function netPoundsOf(netWeightGrams: ProfitLineInput["netWeightGrams"], totalUnits: number): Decimal {
    const missing = () => new AppError(422, "errors.profit_net_weight_missing")
    if (netWeightGrams == null || !Number.isSafeInteger(totalUnits) || totalUnits <= 0) throw missing()
    let grams: Decimal
    try { grams = toDecimal(netWeightGrams) } catch { throw missing() }
    if (!grams.isFinite() || grams.lte(0)) throw missing()
    return grams.times(totalUnits).dividedBy(GRAMS_PER_POUND)
}

// Una línea: ganancia = monto por libra × libras netas (redondeada una vez a 4 decimales);
// precio final = costo + ganancia.
export function buildProfitLine(line: ProfitLineInput, profitPerPound: number | string): ProfitLine {
    const perPound = parseProfitPerPound(profitPerPound)
    const pounds = netPoundsOf(line.netWeightGrams, line.totalUnits)
    const profitTotal = roundMoney(perPound.times(pounds))
    return {
        netPounds: pounds.toDecimalPlaces(6).toNumber(),
        profitPerPound: perPound.toNumber(),
        profitTotal,
        finalPrice: sumMoney([roundMoney(toDecimal(line.totalCost)), profitTotal]),
    }
}

// Un pedido: el mismo monto por libra para cada línea (decisión del responsable, 2026-10-28). Los
// totales suman las líneas ya redondeadas, así el total coincide con lo que muestra cada línea.
export function buildOrderProfit(lines: ProfitLineInput[], profitPerPound: number | string) {
    const perPound = parseProfitPerPound(profitPerPound)
    const profitLines = lines.map(line => buildProfitLine(line, perPound.toString()))
    return {
        profitPerPound: perPound.toNumber(),
        lines: profitLines,
        netPounds: sumPounds(profitLines).toDecimalPlaces(6).toNumber(),
        totalCost: sumMoney(lines.map(line => roundMoney(toDecimal(line.totalCost)))),
        profitTotal: sumMoney(profitLines.map(line => line.profitTotal)),
        finalPrice: sumMoney(profitLines.map(line => line.finalPrice)),
    }
}

function sumPounds(lines: ProfitLine[]): Decimal {
    return lines.reduce((sum, line) => sum.plus(line.netPounds), new Decimal(0))
}
