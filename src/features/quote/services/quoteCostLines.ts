import Decimal from "decimal.js"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import Unit from "../../unit/models/Unit.model"
import Packaging from "../../packaging/models/Packaging.model"
import Destination from "../../destination/models/Destination.model"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import ProcessingCostTranslation from "../../processingCost/models/ProcessingCostTranslation.model"
import { getUnitCatalogEntry } from "../../unit/constants/unitCatalog"
import { AppError } from "../../../shared/errors/AppError"
import { ContentLanguage, pickTranslatedName } from "../../../shared/utils/translation.util"
import { toDecimal, roundMoney, sumMoney } from "../../../shared/utils/money.util"
import { normalizeOptionGroup } from "../../../shared/utils/optionGroup.util"
import { RawMaterialMixLineInput } from "../schemas/quote.schema"

// Matemática por línea del cotizador, COMPARTIDA: cada builder recibe valores planos (costos,
// cantidades, peso neto, unidades) y nunca un ProductVariant, así el motor de productos definidos
// (quote.service.ts::calculateQuote, que los lee de la variante) y cualquier otro motor que obtenga
// esos mismos valores de otra fuente costean exactamente igual. Extraído de quote.service.ts sin
// cambiar ningún número (la suite de quote.service.test.ts pasa sin editar).

const GRAMS_PER_POUND = getUnitCatalogEntry("pound")!.baseFactor

export interface RawMaterialLine {
    rawMaterialId: number
    displayName: string
    unitCost: number
    quantityPerUnit: number
    totalUnits: number
    lineTotal: number
}

// Ingrediente agregado (sal, azúcar...) -- línea aparte de RawMaterialLine porque NO forma parte del
// 100% de la receta base. Congela los gramos y el peso de referencia tal como se definieron
// (grams / referenceNetWeightGrams) y los gramos ya escalados a la presentación cotizada
// (gramsPerUnit), además del costo.
export interface IngredientLine {
    ingredientId: number
    displayName: string
    grams: number
    referenceNetWeightGrams: number
    gramsPerUnit: number
    unitCost: number
    quantityPerUnit: number
    totalUnits: number
    lineTotal: number
}

// optionGroup (aditivo, sin matemática): el grupo de opciones al que pertenecía la fila
// costeada (null = fila fija), congelado en el snapshot para que el desglose admin muestre
// "Caja: caja de envío" aunque el admin renombre el grupo después.
export interface UnitMaterialLine {
    packagingId: number
    displayName: string
    optionGroup: string | null
    unitCost: number
    quantityPerUnit: number
    totalUnits: number
    lineTotal: number
}

export interface IntermediateMaterialLine {
    packagingId: number
    displayName: string
    optionGroup: string | null
    unitCost: number
    unitsPerPackage: number
    totalUnits: number
    packagesNeeded: number
    lineTotal: number
}

export interface ProcessingCostLine {
    processingCostId: number
    displayName: string
    value: number
    totalWeightPounds: number
    lineTotal: number
}

export interface PercentageCostLine {
    processingCostId: number
    displayName: string
    value: number
    baseAmount: number
    lineTotal: number
}

export interface PalletMaterialLine {
    packagingId: number
    displayName: string
    optionGroup: string | null
    unitCost: number
    quantityPerPallet: number
    requestedPallets: number
    lineTotal: number
}

export interface TransportLine {
    destinationId: number | null
    displayName: string
    baseCost: number
}

export interface AdjustmentLine {
    unitCost: number
    totalUnits: number
    lineTotal: number
}

export const MIX_PERCENTAGE_TOLERANCE = new Decimal(0.5)

interface NetWeightShareErrorKeys {
    missingCostUnit: string
    costUnitTypeMismatch: string
    // Parámetros i18n que identifican la fila en el mensaje ({ rawMaterialId } / { ingredientId }).
    params: Record<string, unknown>
}

// Matemática pura "% del peso neto -> costo", compartida por TODO lo que se costea como una
// porción del peso neto de la presentación: la receta fija, la mezcla personalizable y los
// ingredientes agregados (buildIngredientLine). % -> gramos por unidad (sobre el peso neto) ->
// cantidad en la unidad de costeo (÷ costUnit.baseFactor) -> costo × unidades totales. Solo cambia
// quién aporta el % y qué claves de error se usan; la conversión vive una sola vez acá.
export function computeNetWeightShareCost(
    costPerUnit: number | string | null | undefined,
    costUnit: Unit | null | undefined,
    percentage: Decimal,
    netWeight: Decimal,
    totalUnitsDecimal: Decimal,
    errorKeys: NetWeightShareErrorKeys
): { unitCost: Decimal; quantityPerUnitDecimal: Decimal; lineTotal: number } {
    const unitCost = toDecimal(costPerUnit ?? 0)
    if (!costUnit) {
        throw new AppError(422, errorKeys.missingCostUnit, errorKeys.params)
    }

    if (costUnit.unitType !== "weight") {
        throw new AppError(422, errorKeys.costUnitTypeMismatch, {
            ...errorKeys.params,
            unitType: costUnit.unitType
        })
    }

    const costUnitBaseFactor = toDecimal(costUnit.baseFactor)
    const gramsPerUnit = percentage.dividedBy(100).times(netWeight)
    const quantityPerUnitDecimal = gramsPerUnit.dividedBy(costUnitBaseFactor)
    const lineTotal = roundMoney(unitCost.times(quantityPerUnitDecimal).times(totalUnitsDecimal))

    return { unitCost, quantityPerUnitDecimal, lineTotal }
}

// Receta fija (% fijado por el admin) y mix personalizable (% elegido por el cliente dentro de un
// rango) -- quién define el % y cuándo queda congelado es la única diferencia real entre ambos
// caminos; la matemática vive en computeNetWeightShareCost.
export function buildPercentageRawMaterialLine(
    rawMaterialId: number,
    rawMaterial: RawMaterial,
    percentage: Decimal,
    netWeight: Decimal,
    totalUnits: number,
    totalUnitsDecimal: Decimal,
    language: ContentLanguage
): RawMaterialLine {
    const { unitCost, quantityPerUnitDecimal, lineTotal } = computeNetWeightShareCost(
        rawMaterial?.costPerUnit,
        rawMaterial?.costUnit,
        percentage,
        netWeight,
        totalUnitsDecimal,
        {
            missingCostUnit: "errors.raw_material_missing_cost_unit",
            costUnitTypeMismatch: "errors.raw_material_cost_unit_type_mismatch",
            params: { rawMaterialId }
        }
    )

    return {
        rawMaterialId,
        displayName: pickTranslatedName(rawMaterial?.displayName ?? "", rawMaterial?.translations, language),
        unitCost: unitCost.toNumber(),
        quantityPerUnit: quantityPerUnitDecimal.toDecimalPlaces(6).toNumber(),
        totalUnits,
        lineTotal
    }
}

// Una entrada del pool de materias primas que el cliente puede mezclar. Tipo ESTRUCTURAL (no
// ProductRawMaterial) para que cualquier lista de permitidos con esta forma sirva de pool --
// ProductRawMaterial la cumple tal cual. min/max ausentes = 0 / 100.
export interface RawMaterialPoolEntry {
    rawMaterialId: number
    minPercentage?: number | string | null
    maxPercentage?: number | string | null
    usedRawMaterial: RawMaterial
}

export function buildCustomizableRawMaterials(
    pool: RawMaterialPoolEntry[],
    mix: RawMaterialMixLineInput[] | undefined,
    netWeightGrams: number,
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    if (!mix || mix.length === 0) {
        throw new AppError(422, "errors.raw_material_mix_required")
    }
    if (!netWeightGrams || netWeightGrams <= 0) {
        throw new AppError(422, "errors.presentation_missing_net_weight")
    }

    const poolByRawMaterialId = new Map(pool.map(poolEntry => [poolEntry.rawMaterialId, poolEntry]))
    const seenRawMaterialIds = new Set<number>()
    const netWeight = toDecimal(netWeightGrams)
    const totalUnitsDecimal = toDecimal(totalUnits)

    let percentageTotal = new Decimal(0)
    const rawMaterials: RawMaterialLine[] = mix.map(mixLine => {
        if (seenRawMaterialIds.has(mixLine.rawMaterialId)) {
            throw new AppError(422, "errors.duplicate_raw_material_in_mix", { rawMaterialId: mixLine.rawMaterialId })
        }
        seenRawMaterialIds.add(mixLine.rawMaterialId)

        const poolEntry = poolByRawMaterialId.get(mixLine.rawMaterialId)
        if (!poolEntry) {
            throw new AppError(422, "errors.raw_material_not_in_pool", { rawMaterialId: mixLine.rawMaterialId })
        }

        const minPercentage = poolEntry.minPercentage !== null && poolEntry.minPercentage !== undefined ? Number(poolEntry.minPercentage) : 0
        const maxPercentage = poolEntry.maxPercentage !== null && poolEntry.maxPercentage !== undefined ? Number(poolEntry.maxPercentage) : 100
        if (mixLine.percentage < minPercentage || mixLine.percentage > maxPercentage) {
            throw new AppError(422, "errors.raw_material_percentage_out_of_range", {
                rawMaterialId: mixLine.rawMaterialId,
                minPercentage,
                maxPercentage
            })
        }

        const percentage = toDecimal(mixLine.percentage)
        percentageTotal = percentageTotal.plus(percentage)

        return buildPercentageRawMaterialLine(
            mixLine.rawMaterialId,
            poolEntry.usedRawMaterial,
            percentage,
            netWeight,
            totalUnits,
            totalUnitsDecimal,
            language
        )
    })

    if (percentageTotal.minus(100).abs().greaterThan(MIX_PERCENTAGE_TOLERANCE)) {
        throw new AppError(422, "errors.mix_percentage_must_total_100", { percentageTotal: percentageTotal.toDecimalPlaces(2).toNumber() })
    }

    return rawMaterials
}

// Un ingrediente agregado (sal, azúcar...) costeado como porción EXTRA del peso neto: "grams en una
// presentación de referenceNetWeightGrams" -> % sin redondear (decimal.js) -> la MISMA matemática que
// la receta (computeNetWeightShareCost), así escala con el peso neto de la presentación cotizada.
export function buildIngredientLine(
    ingredientId: number,
    ingredient: Ingredient | undefined,
    gramsValue: number | string,
    referenceNetWeightGramsValue: number | string,
    netWeight: Decimal,
    totalUnits: number,
    totalUnitsDecimal: Decimal,
    language: ContentLanguage
): IngredientLine {
    const grams = toDecimal(gramsValue)
    const referenceNetWeightGrams = toDecimal(referenceNetWeightGramsValue)
    const percentage = grams.dividedBy(referenceNetWeightGrams).times(100)

    const { unitCost, quantityPerUnitDecimal, lineTotal } = computeNetWeightShareCost(
        ingredient?.costPerUnit,
        ingredient?.costUnit,
        percentage,
        netWeight,
        totalUnitsDecimal,
        {
            missingCostUnit: "errors.ingredient_missing_cost_unit",
            costUnitTypeMismatch: "errors.ingredient_cost_unit_type_mismatch",
            params: { ingredientId }
        }
    )

    return {
        ingredientId,
        displayName: pickTranslatedName(ingredient?.displayName ?? "", ingredient?.translations, language),
        grams: grams.toNumber(),
        referenceNetWeightGrams: referenceNetWeightGrams.toNumber(),
        gramsPerUnit: percentage.dividedBy(100).times(netWeight).toDecimalPlaces(6).toNumber(),
        unitCost: unitCost.toNumber(),
        quantityPerUnit: quantityPerUnitDecimal.toDecimalPlaces(6).toNumber(),
        totalUnits,
        lineTotal
    }
}

// Empaque unitario: unitCost × cantidad por unidad × unidades totales.
export function buildUnitMaterialLine(
    packagingId: number,
    packaging: Packaging | undefined,
    optionGroup: string | null,
    quantityPerUnitValue: number | string,
    totalUnits: number
): UnitMaterialLine {
    const unitCost = toDecimal(packaging?.unitCost ?? 0)
    const quantityPerUnit = toDecimal(quantityPerUnitValue)
    const lineTotal = roundMoney(unitCost.times(quantityPerUnit).times(totalUnits))
    return {
        packagingId,
        displayName: packaging?.displayName ?? "",
        optionGroup: normalizeOptionGroup(optionGroup),
        unitCost: unitCost.toNumber(),
        quantityPerUnit: quantityPerUnit.toNumber(),
        totalUnits,
        lineTotal
    }
}

// Una línea por fila resuelta del nivel intermedio (N filas, no una sola línea o null).
// Fórmula: ceil(totalUnits / unitsPerIntermediatePackage) × unitCost, con el mismo
// unitsPerIntermediatePackage para todas las filas; el chequeo de que esté configurado corre en
// cuanto hay al menos una fila que costear.
export function buildIntermediateMaterialLine(
    packagingId: number,
    packaging: Packaging | undefined,
    optionGroup: string | null,
    unitsPerIntermediatePackage: number | null | undefined,
    totalUnits: number
): IntermediateMaterialLine {
    if (!unitsPerIntermediatePackage || unitsPerIntermediatePackage <= 0) {
        throw new AppError(422, "errors.intermediate_packaging_missing_units")
    }
    const unitCost = toDecimal(packaging?.unitCost ?? 0)
    const packagesNeeded = Math.ceil(totalUnits / unitsPerIntermediatePackage)
    return {
        packagingId,
        displayName: packaging?.displayName ?? "",
        optionGroup: normalizeOptionGroup(optionGroup),
        unitCost: unitCost.toNumber(),
        unitsPerPackage: unitsPerIntermediatePackage,
        totalUnits,
        packagesNeeded,
        lineTotal: roundMoney(unitCost.times(packagesNeeded))
    }
}

// Material de paletización: unitCost × cantidad por palet × palets pedidos (escala por palets, no
// por unidades).
export function buildPalletMaterialLine(
    packagingId: number,
    packaging: Packaging | undefined,
    optionGroup: string | null,
    quantityPerPalletValue: number | string,
    requestedPallets: number
): PalletMaterialLine {
    const unitCost = toDecimal(packaging?.unitCost ?? 0)
    const quantityPerPallet = toDecimal(quantityPerPalletValue)
    const lineTotal = roundMoney(unitCost.times(quantityPerPallet).times(requestedPallets))
    return {
        packagingId,
        displayName: packaging?.displayName ?? "",
        optionGroup: normalizeOptionGroup(optionGroup),
        unitCost: unitCost.toNumber(),
        quantityPerPallet: quantityPerPallet.toNumber(),
        requestedPallets,
        lineTotal
    }
}

// "Costos adicionales" per_weight: valor × peso total en libras. El peso neto solo se exige si hay
// al menos un costo per_weight activo.
export async function buildPerWeightProcessingCostLines(
    netWeightGrams: number,
    totalUnits: number,
    language: ContentLanguage
): Promise<ProcessingCostLine[]> {
    const activeProcessingCosts = await ProcessingCost.findAll({
        where: { isActive: true, calculationType: "per_weight" },
        include: [{ model: ProcessingCostTranslation, as: "translations" }]
    })

    const perWeightProcessingCosts = activeProcessingCosts.filter(processingCost => processingCost.calculationType === "per_weight")
    if (perWeightProcessingCosts.length === 0) return []

    if (netWeightGrams <= 0) {
        throw new AppError(422, "errors.presentation_missing_net_weight")
    }

    const totalWeightGrams = toDecimal(netWeightGrams).times(totalUnits)
    const totalWeightPounds = totalWeightGrams.dividedBy(GRAMS_PER_POUND)

    return perWeightProcessingCosts.map(processingCost => {
        const value = toDecimal(processingCost.value)
        const lineTotal = roundMoney(value.times(totalWeightPounds))
        return {
            processingCostId: processingCost.id,
            displayName: pickTranslatedName(processingCost.displayName, processingCost.translations, language),
            value: value.toNumber(),
            totalWeightPounds: totalWeightPounds.toDecimalPlaces(6).toNumber(),
            lineTotal
        }
    })
}

async function buildPercentageCostLines(percentageBase: number, language: ContentLanguage): Promise<PercentageCostLine[]> {
    const activePercentageCosts = await ProcessingCost.findAll({
        where: { isActive: true, calculationType: "percentage" },
        include: [{ model: ProcessingCostTranslation, as: "translations" }]
    })
    const percentageOnlyCosts = activePercentageCosts.filter(processingCost => processingCost.calculationType === "percentage")
    const percentageBaseDecimal = toDecimal(percentageBase)
    return percentageOnlyCosts.map(processingCost => {
        const value = toDecimal(processingCost.value)
        const lineTotal = roundMoney(percentageBaseDecimal.times(value).dividedBy(100))
        return {
            processingCostId: processingCost.id,
            displayName: pickTranslatedName(processingCost.displayName, processingCost.translations, language),
            value: value.toNumber(),
            baseAmount: percentageBase,
            lineTotal
        }
    })
}

export function buildTransportLine(destination: Destination | null, language: ContentLanguage): { transportCost: number; transport: TransportLine } {
    const transportCost = destination ? roundMoney(toDecimal(destination.baseCost)) : 0
    const transport: TransportLine = destination
        ? { destinationId: destination.id, displayName: destination.displayName, baseCost: transportCost }
        : { destinationId: null, displayName: language === "en" ? "No destination" : "Sin destino", baseCost: 0 }
    return { transportCost, transport }
}

// Ajuste manual por unidad (Product.additionalCostPerUnit en productos definidos). Sin ajuste
// (0) -> línea null y costo 0.
export function buildAdjustmentLine(
    additionalCostPerUnitValue: number | string | null | undefined,
    totalUnits: number
): { adjustmentCost: number; adjustment: AdjustmentLine | null } {
    const additionalCostPerUnit = toDecimal(additionalCostPerUnitValue ?? 0)
    const adjustmentCost = roundMoney(additionalCostPerUnit.times(totalUnits))
    const adjustment: AdjustmentLine | null = additionalCostPerUnit.greaterThan(0)
        ? { unitCost: additionalCostPerUnit.toNumber(), totalUnits, lineTotal: adjustmentCost }
        : null
    return { adjustmentCost, adjustment }
}

export interface QuoteCostSubtotals {
    rawMaterialCost: number
    ingredientCost: number
    unitPackagingCost: number
    intermediatePackagingCost: number
    processingCostTotal: number
    palletMaterialCost: number
    transportCost: number
    adjustmentCost: number
}

// El ÚNICO lugar que define la base de los "Costos adicionales" percentage y el total. La base es
// materia prima + ingredientes + costos per_weight + empaque unitario/intermedio + paletización;
// transporte y ajuste manual quedan FUERA de la base pero dentro del total. Varios costos % activos
// suman sobre la misma base (no se componen).
export async function assembleQuoteTotals(
    subtotals: QuoteCostSubtotals,
    language: ContentLanguage
): Promise<{ percentageCosts: PercentageCostLine[]; percentageCostTotal: number; totalCost: number }> {
    const percentageBase = sumMoney([
        subtotals.rawMaterialCost,
        subtotals.ingredientCost,
        subtotals.processingCostTotal,
        subtotals.unitPackagingCost,
        subtotals.intermediatePackagingCost,
        subtotals.palletMaterialCost
    ])
    const percentageCosts = await buildPercentageCostLines(percentageBase, language)
    const percentageCostTotal = sumMoney(percentageCosts.map(line => line.lineTotal))

    const totalCost = sumMoney([
        subtotals.rawMaterialCost,
        subtotals.ingredientCost,
        subtotals.unitPackagingCost,
        subtotals.intermediatePackagingCost,
        subtotals.processingCostTotal,
        subtotals.palletMaterialCost,
        percentageCostTotal,
        subtotals.transportCost,
        subtotals.adjustmentCost
    ])

    return { percentageCosts, percentageCostTotal, totalCost }
}
