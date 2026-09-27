import { Op } from "sequelize"
import ProductVariant from "../../product/models/ProductVariant.model"
import Product from "../../product/models/Product.model"
import ProductTranslation from "../../product/models/ProductTranslation.model"
import ProductRawMaterial from "../../product/models/ProductRawMaterial.model"
import SubCategory from "../../category/models/SubCategory.model"
import Category from "../../category/models/Category.model"
import CategoryTranslation from "../../category/models/CategoryTranslation.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../../rawMaterial/models/RawMaterialTranslation.model"
import Unit from "../../unit/models/Unit.model"
import Packaging from "../../packaging/models/Packaging.model"
import Presentation from "../../presentation/models/Presentation.model"
import ProductVariantPalletMaterial from "../../product/models/ProductVariantPalletMaterial.model"
import ProductVariantUnitMaterial from "../../product/models/ProductVariantUnitMaterial.model"
import ProductVariantIntermediateMaterial from "../../product/models/ProductVariantIntermediateMaterial.model"
import Destination from "../../destination/models/Destination.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import Quote from "../models/Quote.model"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import ProcessingCostTranslation from "../../processingCost/models/ProcessingCostTranslation.model"
import { getUnitCatalogEntry } from "../../unit/constants/unitCatalog"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CalculateQuoteInput, RawMaterialMixLineInput } from "../schemas/quote.schema"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE, pickTranslatedName } from "../../../shared/utils/translation.util"
import { toDecimal, roundMoney, sumMoney } from "../../../shared/utils/money.util"
import { normalizeOptionGroup, optionGroupKey } from "../../../shared/utils/optionGroup.util"
import Decimal from "decimal.js"

const GRAMS_PER_POUND = getUnitCatalogEntry("pound")!.baseFactor

interface RawMaterialLine {
    rawMaterialId: number
    displayName: string
    unitCost: number
    quantityPerUnit: number
    totalUnits: number
    lineTotal: number
}

// optionGroup (2026-09-24, aditivo, sin matemática): el grupo de opciones al que pertenecía la fila
// costeada (null = fila fija), congelado en el snapshot para que el desglose admin muestre
// "Caja: caja de envío" aunque el admin renombre el grupo después.
interface UnitMaterialLine {
    packagingId: number
    displayName: string
    optionGroup: string | null
    unitCost: number
    quantityPerUnit: number
    totalUnits: number
    lineTotal: number
}

interface IntermediateMaterialLine {
    packagingId: number
    displayName: string
    optionGroup: string | null
    unitCost: number
    unitsPerPackage: number
    totalUnits: number
    packagesNeeded: number
    lineTotal: number
}

interface ProcessingCostLine {
    processingCostId: number
    displayName: string
    value: number
    totalWeightPounds: number
    lineTotal: number
}

interface PercentageCostLine {
    processingCostId: number
    displayName: string
    value: number
    baseAmount: number
    lineTotal: number
}

interface PalletMaterialLine {
    packagingId: number
    displayName: string
    optionGroup: string | null
    unitCost: number
    quantityPerPallet: number
    requestedPallets: number
    lineTotal: number
}

interface TransportLine {
    destinationId: number | null
    displayName: string
    baseCost: number
}

interface AdjustmentLine {
    unitCost: number
    totalUnits: number
    lineTotal: number
}

interface QuoteCalculation {
    productVariantId: number
    // null cuando no se mandó destinationId -- ver TransportLine.destinationId arriba.
    destinationId: number | null
    productDisplayName: string
    variantLabel: string | null
    requestedPallets: number
    totalUnits: number
    boxesPerPallet: number
    rawMaterialCost: number
    unitPackagingCost: number
    intermediatePackagingCost: number
    processingCostTotal: number
    palletMaterialCost: number
    percentageCostTotal: number
    transportCost: number
    adjustmentCost: number
    totalCost: number
    breakdown: {
        rawMaterials: RawMaterialLine[]
        unitMaterials: UnitMaterialLine[]
        // Array desde 2026-09-24 (antes un único objeto o null) -- el nivel intermedio ahora admite
        // N filas fijas + N grupos de opciones, igual que unit/pallet.
        intermediateMaterials: IntermediateMaterialLine[]
        processingCosts: ProcessingCostLine[]
        palletMaterials: PalletMaterialLine[]
        percentageCosts: PercentageCostLine[]
        transport: TransportLine
        adjustment: AdjustmentLine | null
        language: ContentLanguage
    }
}


const MIX_PERCENTAGE_TOLERANCE = new Decimal(0.5)

// Matemática compartida entre receta fija (% fijado por el admin) y mix personalizable (% elegido
// por el cliente dentro de un rango) -- % -> gramos (sobre el peso neto de la presentación) ->
// cantidad en la unidad de costeo de la materia prima -> costo. Quién define el % y cuándo queda
// congelado es la única diferencia real entre ambos caminos (ver buildFixedPercentageRawMaterials
// vs. buildCustomizableRawMaterials más abajo), así que esta función vive una sola vez.
function buildPercentageRawMaterialLine(
    rawMaterialId: number,
    rawMaterial: RawMaterial,
    percentage: Decimal,
    netWeight: Decimal,
    totalUnits: number,
    totalUnitsDecimal: Decimal,
    language: ContentLanguage
): RawMaterialLine {
    const unitCost = toDecimal(rawMaterial?.costPerUnit ?? 0)
    if (!rawMaterial?.costUnit) {
        throw new AppError(422, "errors.raw_material_missing_cost_unit", { rawMaterialId })
    }

    if (rawMaterial.costUnit.unitType !== "weight") {
        throw new AppError(422, "errors.raw_material_cost_unit_type_mismatch", {
            rawMaterialId,
            unitType: rawMaterial.costUnit.unitType
        })
    }

    const costUnitBaseFactor = toDecimal(rawMaterial.costUnit.baseFactor)
    const gramsPerUnit = percentage.dividedBy(100).times(netWeight)
    const quantityPerUnitDecimal = gramsPerUnit.dividedBy(costUnitBaseFactor)
    const lineTotal = roundMoney(unitCost.times(quantityPerUnitDecimal).times(totalUnitsDecimal))

    return {
        rawMaterialId,
        displayName: pickTranslatedName(rawMaterial?.displayName ?? "", rawMaterial?.translations, language),
        unitCost: unitCost.toNumber(),
        quantityPerUnit: quantityPerUnitDecimal.toDecimalPlaces(6).toNumber(),
        totalUnits,
        lineTotal
    }
}

// Receta fija (!Product.isCustomizable): el % de cada materia prima lo fija el admin al crear el
// producto (ProductRawMaterial.percentage) y el cliente nunca lo puede alterar -- calculateQuote
// jamás lee input.rawMaterialMix acá (ver buildRawMaterialLines). Si el producto no tiene NINGUNA
// materia prima activa configurada todavía, se devuelve $0 sin exigir ni peso neto ni que sume 100
// -- mismo comportamiento "no configurado" que ya tenía el motor viejo con quantityValue vacío,
// para no romper variantes que todavía no tienen su receta cargada.
function buildFixedPercentageRawMaterials(
    productRawMaterials: ProductRawMaterial[],
    netWeightGrams: number,
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    if (productRawMaterials.length === 0) return []

    if (!netWeightGrams || netWeightGrams <= 0) {
        throw new AppError(422, "errors.presentation_missing_net_weight")
    }

    const netWeight = toDecimal(netWeightGrams)
    const totalUnitsDecimal = toDecimal(totalUnits)

    let percentageTotal = new Decimal(0)
    const rawMaterials: RawMaterialLine[] = productRawMaterials.map(productRawMaterial => {
        const percentage = toDecimal(productRawMaterial.percentage ?? 0)
        percentageTotal = percentageTotal.plus(percentage)

        return buildPercentageRawMaterialLine(
            productRawMaterial.rawMaterialId,
            productRawMaterial.usedRawMaterial,
            percentage,
            netWeight,
            totalUnits,
            totalUnitsDecimal,
            language
        )
    })

    // Autoritativo (a diferencia del techo "blando" de productRawMaterial.service.ts, que solo
    // evita GUARDAR una receta que ya se pase de 100 mientras se arma fila por fila): acá SÍ debe
    // sumar 100 exacto (± tolerancia) porque se está cotizando de verdad. Clave de error distinta
    // a la del mix personalizable a propósito -- el significado para quien lo lee es otro ("este
    // producto está mal configurado", no "tu mezcla no cuadra").
    if (percentageTotal.minus(100).abs().greaterThan(MIX_PERCENTAGE_TOLERANCE)) {
        throw new AppError(422, "errors.fixed_recipe_percentage_must_total_100", { percentageTotal: percentageTotal.toDecimalPlaces(2).toNumber() })
    }

    return rawMaterials
}


function buildCustomizableRawMaterials(
    pool: ProductRawMaterial[],
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

    const poolByRawMaterialId = new Map(pool.map(productRawMaterial => [productRawMaterial.rawMaterialId, productRawMaterial]))
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

async function loadQuoteVariant(productVariantId: number): Promise<{ variant: ProductVariant; bagsPerPallet: number }> {
    const variant = await ProductVariant.findOne({
        where: { id: productVariantId, isActive: true },
        include: [
            {
                model: Product,
                as: "parentProduct",
                include: [
                    {
                        model: ProductRawMaterial,
                        as: "productRawMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [
                            {
                                model: RawMaterial,
                                as: "usedRawMaterial",
                                include: [
                                    { model: Unit, as: "costUnit" },
                                    { model: RawMaterialTranslation, as: "translations" }
                                ]
                            }
                        ]
                    },
                    { model: ProductTranslation, as: "translations" }
                ]
            },
            { model: Presentation, as: "sizePresentation" },
            {
                model: ProductVariantPalletMaterial,
                as: "palletMaterials",
                where: { isActive: true },
                required: false,
                include: [{ model: Packaging, as: "usedPalletMaterial" }]
            },
            {
                model: ProductVariantUnitMaterial,
                as: "unitMaterials",
                where: { isActive: true },
                required: false,
                include: [{ model: Packaging, as: "usedUnitMaterial" }]
            },
            {
                // Se cargan TODAS las filas activas (fijas + de cada grupo), nunca solo
                // isDefault:true, porque resolveMaterialsForQuote necesita el set completo para
                // validar la elección del cliente (ver comentario ahí). Igual que unit/pallet.
                model: ProductVariantIntermediateMaterial,
                as: "intermediateMaterials",
                where: { isActive: true },
                required: false,
                include: [{ model: Packaging, as: "usedIntermediateMaterial" }]
            }
        ]
    })
    if (!variant) throw new NotFoundError("ProductVariant", productVariantId)

    if (!variant.boxesPerPallet || variant.boxesPerPallet <= 0 || !variant.bagsPerBox || variant.bagsPerBox <= 0) {
        throw new AppError(422, "errors.pallet_not_configured")
    }
    const bagsPerPallet = variant.boxesPerPallet * variant.bagsPerBox
    if ((variant.unitMaterials ?? []).length === 0) {
        throw new AppError(422, "errors.unit_materials_not_configured")
    }

    if ((variant.palletMaterials ?? []).length === 0) {
        throw new AppError(422, "errors.pallet_materials_not_configured")
    }

    return { variant, bagsPerPallet }
}

async function resolveQuoteDestination(destinationId: number | undefined): Promise<Destination | null> {
    const destination = destinationId
        ? await Destination.findOne({ where: { id: destinationId, isActive: true } })
        : null
    if (destinationId && !destination) throw new NotFoundError("Destination", destinationId)
    return destination
}

function buildRawMaterialLines(
    variant: ProductVariant,
    input: CalculateQuoteInput,
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    const netWeightGrams = Number(variant.sizePresentation?.netWeightGrams ?? 0)
    // El cliente nunca puede alterar una receta fija: input.rawMaterialMix ni siquiera se lee acá
    // en ese caso -- los % vienen únicamente de ProductRawMaterial.percentage (fijados por el
    // admin), ver buildFixedPercentageRawMaterials.
    return variant.parentProduct?.isCustomizable
        ? buildCustomizableRawMaterials(
              variant.parentProduct.productRawMaterials ?? [],
              input.rawMaterialMix,
              netWeightGrams,
              totalUnits,
              language
          )
        : buildFixedPercentageRawMaterials(variant.parentProduct?.productRawMaterials ?? [], netWeightGrams, totalUnits, language)
}

type MaterialLevel = "unit" | "intermediate" | "pallet"

interface GroupedMaterialRow {
    // Opcional, no solo number -- sequelize-typescript tipa Model.id como opcional (una instancia
    // sin guardar aún no tiene id), aunque en la práctica cualquier fila leída de la BD siempre lo
    // trae.
    id?: number
    optionGroup: string | null
    isDefault: boolean
}

// Claves literales por nivel (no armadas con template string) para que sigan siendo grep-ables
// contra los locales.
const MATERIAL_LEVEL_ERROR_KEYS: Record<MaterialLevel, { invalidSelection: string; defaultNotConfigured: string }> = {
    unit: {
        invalidSelection: "errors.invalid_unit_material_selection",
        defaultNotConfigured: "errors.unit_material_default_not_configured"
    },
    intermediate: {
        invalidSelection: "errors.invalid_intermediate_material_selection",
        defaultNotConfigured: "errors.intermediate_material_default_not_configured"
    },
    pallet: {
        invalidSelection: "errors.invalid_pallet_material_selection",
        defaultNotConfigured: "errors.pallet_material_default_not_configured"
    }
}

interface MaterialOptionGroupBucket<T> {
    label: string
    rows: T[]
}

// Agrupa las filas de un nivel por la clave normalizada de optionGroup (insensible a mayúsculas/
// espacios, misma regla que usan los servicios al guardar -- ver shared/utils/optionGroup.util.ts).
// Las filas sin grupo son la receta fija. Orden estable por id, para que el menú del catálogo y el
// snapshot no dependan del orden en que Sequelize devolvió el include.
function bucketMaterialsByGroup<T extends GroupedMaterialRow>(
    allRows: T[]
): { fixedRows: T[]; groups: Map<string, MaterialOptionGroupBucket<T>> } {
    const sortedRows = [...allRows].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    const fixedRows: T[] = []
    const groups = new Map<string, MaterialOptionGroupBucket<T>>()
    for (const row of sortedRows) {
        const key = optionGroupKey(row.optionGroup)
        if (key === null) {
            fixedRows.push(row)
            continue
        }
        const bucket = groups.get(key) ?? { label: normalizeOptionGroup(row.optionGroup) ?? key, rows: [] }
        bucket.rows.push(row)
        groups.set(key, bucket)
    }
    return { fixedRows, groups }
}

// Grupos de opciones (2026-09-24, ver CLAUDE.md #4 -- reemplaza el "un solo slot swappable por
// nivel" y el resolver 0-o-1 del intermedio): un mismo resolver para los tres niveles. Devuelve
// las filas fijas (siempre se costean) + UNA fila por grupo: la que eligió el cliente para ese
// grupo, o si no mandó ninguna, el default del grupo. Nunca confía en el cliente: cada id enviado
// debe ser una fila AGRUPADA de este SKU en ESTE nivel (el grupo se lee de la fila, el cliente
// nunca lo declara), y dos ids del mismo grupo se rechazan en vez de costear ambos o elegir uno en
// silencio -- mismo principio que buildCustomizableRawMaterials/poolByRawMaterialId con la mezcla.
// Solo decide QUÉ filas se suman; la matemática por fila vive intacta en calculateQuote.
function resolveMaterialsForQuote<T extends GroupedMaterialRow>(
    allRows: T[],
    selectedIds: number[] | undefined,
    level: MaterialLevel
): T[] {
    const errorKeys = MATERIAL_LEVEL_ERROR_KEYS[level]
    const { fixedRows, groups } = bucketMaterialsByGroup(allRows)

    const chosenByGroup = new Map<string, T>()
    for (const selectedId of selectedIds ?? []) {
        const chosen = allRows.find(row => row.id === selectedId && optionGroupKey(row.optionGroup) !== null)
        if (!chosen) throw new AppError(422, errorKeys.invalidSelection, { selectedId })

        const key = optionGroupKey(chosen.optionGroup) as string
        if (chosenByGroup.has(key)) {
            throw new AppError(422, "errors.duplicate_material_group_selection", { group: groups.get(key)?.label ?? key })
        }
        chosenByGroup.set(key, chosen)
    }

    const resolvedRows = [...fixedRows]
    for (const [key, bucket] of groups) {
        const resolved = chosenByGroup.get(key) ?? bucket.rows.find(row => row.isDefault)
        if (!resolved) throw new AppError(422, errorKeys.defaultNotConfigured, { group: bucket.label })
        resolvedRows.push(resolved)
    }
    return resolvedRows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}

// Una línea por fila resuelta del nivel intermedio (2026-09-24: antes era una sola línea o null).
// Fórmula sin cambios: ceil(totalUnits / unitsPerIntermediatePackage) × unitCost, con el mismo
// unitsPerIntermediatePackage de la variante para todas las filas; el chequeo de que esté
// configurado corre en cuanto hay al menos una fila que costear.
function buildIntermediateMaterialLine(
    variant: ProductVariant,
    resolvedMaterial: ProductVariantIntermediateMaterial,
    totalUnits: number
): IntermediateMaterialLine {
    if (!variant.unitsPerIntermediatePackage || variant.unitsPerIntermediatePackage <= 0) {
        throw new AppError(422, "errors.intermediate_packaging_missing_units")
    }
    const unitCost = toDecimal(resolvedMaterial.usedIntermediateMaterial?.unitCost ?? 0)
    const packagesNeeded = Math.ceil(totalUnits / variant.unitsPerIntermediatePackage)
    return {
        packagingId: resolvedMaterial.packagingId,
        displayName: resolvedMaterial.usedIntermediateMaterial?.displayName ?? "",
        optionGroup: normalizeOptionGroup(resolvedMaterial.optionGroup),
        unitCost: unitCost.toNumber(),
        unitsPerPackage: variant.unitsPerIntermediatePackage,
        totalUnits,
        packagesNeeded,
        lineTotal: roundMoney(unitCost.times(packagesNeeded))
    }
}

async function buildPerWeightProcessingCostLines(
    variant: ProductVariant,
    totalUnits: number,
    language: ContentLanguage
): Promise<ProcessingCostLine[]> {
    const activeProcessingCosts = await ProcessingCost.findAll({
        where: { isActive: true, calculationType: "per_weight" },
        include: [{ model: ProcessingCostTranslation, as: "translations" }]
    })

    const perWeightProcessingCosts = activeProcessingCosts.filter(processingCost => processingCost.calculationType === "per_weight")
    if (perWeightProcessingCosts.length === 0) return []


    const netWeightGrams = Number(variant.sizePresentation?.netWeightGrams ?? 0)
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

function buildTransportLine(destination: Destination | null, language: ContentLanguage): { transportCost: number; transport: TransportLine } {
    const transportCost = destination ? roundMoney(toDecimal(destination.baseCost)) : 0
    const transport: TransportLine = destination
        ? { destinationId: destination.id, displayName: destination.displayName, baseCost: transportCost }
        : { destinationId: null, displayName: language === "en" ? "No destination" : "Sin destino", baseCost: 0 }
    return { transportCost, transport }
}

function buildAdjustmentLine(variant: ProductVariant, totalUnits: number): { adjustmentCost: number; adjustment: AdjustmentLine | null } {
    const additionalCostPerUnit = toDecimal(variant.parentProduct?.additionalCostPerUnit ?? 0)
    const adjustmentCost = roundMoney(additionalCostPerUnit.times(totalUnits))
    const adjustment: AdjustmentLine | null = additionalCostPerUnit.greaterThan(0)
        ? { unitCost: additionalCostPerUnit.toNumber(), totalUnits, lineTotal: adjustmentCost }
        : null
    return { adjustmentCost, adjustment }
}


function buildVariantLabel(variant: ProductVariant, language: ContentLanguage): string {
    const unitsPerBoxLabel = language === "en" ? `${variant.bagsPerBox} units` : `${variant.bagsPerBox} und`
    const sizePart = variant.sizePresentation?.displayLabel
        ? `${unitsPerBoxLabel} × ${variant.sizePresentation.displayLabel}`
        : unitsPerBoxLabel
    const boxesPerPalletLabel = language === "en"
        ? `${variant.boxesPerPallet} boxes/pallet`
        : `${variant.boxesPerPallet} cajas/palet`
    return [sizePart, boxesPerPalletLabel].join(" · ")
}

async function calculateQuote(input: CalculateQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<QuoteCalculation> {
    const { variant, bagsPerPallet } = await loadQuoteVariant(input.productVariantId)
    const destination = await resolveQuoteDestination(input.destinationId)

    const requestedPallets = input.requestedPallets
    const totalUnits = requestedPallets * bagsPerPallet

    const rawMaterials = buildRawMaterialLines(variant, input, totalUnits, language)
    const rawMaterialCost = sumMoney(rawMaterials.map(line => line.lineTotal))

    const resolvedUnitMaterials = resolveMaterialsForQuote(variant.unitMaterials ?? [], input.selectedUnitMaterialIds, "unit")
    const unitMaterials: UnitMaterialLine[] = resolvedUnitMaterials.map(unitMaterial => {
        const unitCost = toDecimal(unitMaterial.usedUnitMaterial?.unitCost ?? 0)
        const quantityPerUnit = toDecimal(unitMaterial.quantityPerUnit ?? 1)
        const lineTotal = roundMoney(unitCost.times(quantityPerUnit).times(totalUnits))
        return {
            packagingId: unitMaterial.packagingId,
            displayName: unitMaterial.usedUnitMaterial?.displayName ?? "",
            optionGroup: normalizeOptionGroup(unitMaterial.optionGroup),
            unitCost: unitCost.toNumber(),
            quantityPerUnit: quantityPerUnit.toNumber(),
            totalUnits,
            lineTotal
        }
    })
    const unitPackagingCost = sumMoney(unitMaterials.map(line => line.lineTotal))

    const resolvedIntermediateMaterials = resolveMaterialsForQuote(
        variant.intermediateMaterials ?? [],
        input.selectedIntermediateMaterialIds,
        "intermediate"
    )
    const intermediateMaterials = resolvedIntermediateMaterials.map(material => buildIntermediateMaterialLine(variant, material, totalUnits))
    const intermediatePackagingCost = sumMoney(intermediateMaterials.map(line => line.lineTotal))

    const processingCosts = await buildPerWeightProcessingCostLines(variant, totalUnits, language)
    const processingCostTotal = sumMoney(processingCosts.map(line => line.lineTotal))

    const resolvedPalletMaterials = resolveMaterialsForQuote(variant.palletMaterials ?? [], input.selectedPalletMaterialIds, "pallet")
    const palletMaterials: PalletMaterialLine[] = resolvedPalletMaterials.map(palletMaterial => {
        const unitCost = toDecimal(palletMaterial.usedPalletMaterial?.unitCost ?? 0)
        const quantityPerPallet = toDecimal(palletMaterial.quantityValue ?? 0)
        const lineTotal = roundMoney(unitCost.times(quantityPerPallet).times(requestedPallets))
        return {
            packagingId: palletMaterial.packagingId,
            displayName: palletMaterial.usedPalletMaterial?.displayName ?? "",
            optionGroup: normalizeOptionGroup(palletMaterial.optionGroup),
            unitCost: unitCost.toNumber(),
            quantityPerPallet: quantityPerPallet.toNumber(),
            requestedPallets,
            lineTotal
        }
    })
    const palletMaterialCost = sumMoney(palletMaterials.map(line => line.lineTotal))

    const percentageBase = sumMoney([rawMaterialCost, processingCostTotal, unitPackagingCost, intermediatePackagingCost, palletMaterialCost])
    const percentageCosts = await buildPercentageCostLines(percentageBase, language)
    const percentageCostTotal = sumMoney(percentageCosts.map(line => line.lineTotal))

    const { transportCost, transport } = buildTransportLine(destination, language)
    const { adjustmentCost, adjustment } = buildAdjustmentLine(variant, totalUnits)

    const totalCost = sumMoney([
        rawMaterialCost,
        unitPackagingCost,
        intermediatePackagingCost,
        processingCostTotal,
        palletMaterialCost,
        percentageCostTotal,
        transportCost,
        adjustmentCost
    ])

    const variantLabel = buildVariantLabel(variant, language)

    return {
        productVariantId: variant.id,
        destinationId: destination?.id ?? null,
        productDisplayName: pickTranslatedName(variant.parentProduct?.displayName ?? "", variant.parentProduct?.translations, language),
        variantLabel,
        requestedPallets,
        totalUnits,
        boxesPerPallet: variant.boxesPerPallet,
        rawMaterialCost,
        unitPackagingCost,
        intermediatePackagingCost,
        processingCostTotal,
        palletMaterialCost,
        percentageCostTotal,
        transportCost,
        adjustmentCost,
        totalCost,
        breakdown: {
            rawMaterials,
            unitMaterials,
            intermediateMaterials,
            processingCosts,
            palletMaterials,
            percentageCosts,
            transport,
            adjustment,
            language
        }
    }
}

// Grupos de opciones (2026-09-24, ver CLAUDE.md #4): el menú de alternativas de un nivel para que
// el cliente elija al cotizar, ya agrupado por el backend -- un chooser por grupo (ej. "Caja" y
// "Esquinero" en paletización). Solo filas con optionGroup (las fijas nunca son una "opción",
// siempre se costean solas). `id` es el id de la FILA del join
// (ProductVariantUnitMaterial/IntermediateMaterial/PalletMaterial), el mismo que
// calculateQuoteSchema.selectedXMaterialIds espera -- no el packagingId.
interface QuotableMaterialOption {
    id: number
    packagingId: number
    displayName: string
    unitCost: number
    isDefault: boolean
}

interface QuotableMaterialOptionGroup {
    group: string
    options: QuotableMaterialOption[]
}

// Mismo agrupamiento que resolveMaterialsForQuote (bucketMaterialsByGroup), así el menú que ve el
// cliente y lo que el motor acepta nunca pueden divergir.
function buildMaterialOptionGroups<T extends GroupedMaterialRow & { packagingId: number }>(
    rows: T[],
    packagingOf: (row: T) => Packaging | undefined
): QuotableMaterialOptionGroup[] {
    const { groups } = bucketMaterialsByGroup(rows)
    return [...groups.values()].map(bucket => ({
        group: bucket.label,
        options: bucket.rows.map(row => ({
            id: row.id as number,
            packagingId: row.packagingId,
            displayName: packagingOf(row)?.displayName ?? "",
            unitCost: Number(packagingOf(row)?.unitCost ?? 0),
            isDefault: row.isDefault
        }))
    }))
}

interface QuotableVariant {
    id: number
    boxesPerPallet: number
    bagsPerBox: number
    presentationLabel: string | null
    // Peso neto por bolsa/unidad, en gramos (2026-09-22, paso "pallets" del wizard -- ver
    // CLAUDE.md #6) -- solo lectura, mismo dato que ya usa buildRawMaterialLines internamente
    // (variant.sizePresentation.netWeightGrams), expuesto acá para que el frontend calcule el
    // peso total del pedido (boxesPerPallet × bagsPerBox × netWeightGrams × requestedPallets) sin
    // tocar calculateQuote. null si la Presentation no tiene el dato (no debería pasar en la
    // práctica -- netWeightGrams no es nullable a nivel de columna -- pero el include ya lo trae
    // opcional por el mismo criterio defensivo que presentationLabel).
    netWeightGrams: number | null
    packagingLabel: string | null
    unitMaterialOptionGroups: QuotableMaterialOptionGroup[]
    intermediateMaterialOptionGroups: QuotableMaterialOptionGroup[]
    palletMaterialOptionGroups: QuotableMaterialOptionGroup[]
}

interface QuotableRawMaterialOption {
    rawMaterialId: number
    displayName: string
    isOrganic: boolean
    minPercentage: number
    maxPercentage: number
}

// Receta fija (!isCustomizable): el % lo fija el admin y el cliente nunca lo puede alterar (ver
// buildFixedPercentageRawMaterials en este mismo archivo) -- pero SÍ debe poder VER qué está
// cotizando (ej. "100% Piña" / "50% Banano · 50% Fresa"). Distinto de QuotableRawMaterialOption
// (el pool editable del mix personalizable) a propósito: son conceptos diferentes, no la misma
// forma con un campo de más.
interface QuotableFixedRawMaterial {
    rawMaterialId: number
    displayName: string
    percentage: number
}

interface QuotableProduct {
    id: number
    displayName: string
    isOrganic: boolean
    isCustomizable: boolean
    imageUrl: string | null
    categoryId: number
    categoryName: string
    categoryImageUrl: string | null
    rawMaterialPool: QuotableRawMaterialOption[]
    fixedRecipe: QuotableFixedRawMaterial[]
    variants: QuotableVariant[]
}


async function listQuotableProducts(language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<QuotableProduct[]> {
    const products = await Product.findAll({
        where: { isActive: true },
        include: [
            {
                model: ProductVariant,
                as: "productVariants",
                required: true,
                // presentationId ya es NOT NULL a nivel de columna (2026-09-16, cada SKU es un
                // producto + una Presentación) -- este filtro es defensa en profundidad, mismo
                // criterio que boxesPerPallet/bagsPerBox, por si alguna fila vieja quedara sin
                // migrar en un entorno que no pasó por el sync todavía.
                where: {
                    isActive: true,
                    presentationId: { [Op.not]: null },
                    boxesPerPallet: { [Op.not]: null },
                    bagsPerBox: { [Op.not]: null }
                },
                include: [
                    { model: Presentation, as: "sizePresentation" },
                    {
                        model: ProductVariantUnitMaterial,
                        as: "unitMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [{ model: Packaging, as: "usedUnitMaterial" }]
                    },
                    {
                        model: ProductVariantIntermediateMaterial,
                        as: "intermediateMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [{ model: Packaging, as: "usedIntermediateMaterial" }]
                    },
                    {
                        model: ProductVariantPalletMaterial,
                        as: "palletMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [{ model: Packaging, as: "usedPalletMaterial" }]
                    }
                ]
            },
            {
                model: SubCategory,
                as: "parentSubCategory",
                include: [{
                    model: Category,
                    as: "parentCategory",
                    include: [{ model: CategoryTranslation, as: "translations" }]
                }]
            },
            {
                model: ProductRawMaterial,
                as: "productRawMaterials",
                required: false,
                where: { isActive: true },
                include: [{
                    model: RawMaterial,
                    as: "usedRawMaterial",
                    include: [{ model: RawMaterialTranslation, as: "translations" }]
                }]
            },
            { model: ProductTranslation, as: "translations" }
        ],
        order: [["displayName", "ASC"]]
    })

    return products.map(product => {
        const plain = product.toJSON()
        const category = plain.parentSubCategory?.parentCategory
        return {
            id: plain.id,
            displayName: pickTranslatedName(plain.displayName, plain.translations, language),
            isOrganic: plain.isOrganic,
            isCustomizable: plain.isCustomizable,
            imageUrl: plain.imageUrl ?? null,
            categoryId: category?.id ?? 0,
            categoryName: pickTranslatedName(category?.displayName ?? "", category?.translations, language),
            categoryImageUrl: category?.imageUrl ?? null,
            rawMaterialPool: plain.isCustomizable
                ? (plain.productRawMaterials ?? []).map((productRawMaterial: ProductRawMaterial) => ({
                      rawMaterialId: productRawMaterial.rawMaterialId,
                      displayName: pickTranslatedName(productRawMaterial.usedRawMaterial?.displayName ?? "", productRawMaterial.usedRawMaterial?.translations, language),
                      isOrganic: productRawMaterial.usedRawMaterial?.isOrganic ?? false,
                      minPercentage: productRawMaterial.minPercentage !== null && productRawMaterial.minPercentage !== undefined
                          ? Number(productRawMaterial.minPercentage)
                          : 0,
                      maxPercentage: productRawMaterial.maxPercentage !== null && productRawMaterial.maxPercentage !== undefined
                          ? Number(productRawMaterial.maxPercentage)
                          : 100
                  }))
                : [],
            // El cliente no puede editar una receta fija, pero sí debe ver qué está cotizando --
            // ver comentario de QuotableFixedRawMaterial arriba.
            fixedRecipe: plain.isCustomizable
                ? []
                : (plain.productRawMaterials ?? []).map((productRawMaterial: ProductRawMaterial) => ({
                      rawMaterialId: productRawMaterial.rawMaterialId,
                      displayName: pickTranslatedName(productRawMaterial.usedRawMaterial?.displayName ?? "", productRawMaterial.usedRawMaterial?.translations, language),
                      percentage: productRawMaterial.percentage !== null && productRawMaterial.percentage !== undefined
                          ? Number(productRawMaterial.percentage)
                          : 0
                  })),
            variants: (plain.productVariants ?? []).map((variant: ProductVariant) => ({
                id: variant.id,
                boxesPerPallet: variant.boxesPerPallet as number,
                bagsPerBox: variant.bagsPerBox as number,
                presentationLabel: variant.sizePresentation?.displayLabel ?? null,
                // Presentation.netWeightGrams es DECIMAL(10,2) -- igual que unitCost/percentage
                // más abajo en este mismo DTO, Sequelize/pg lo devuelve como STRING en runtime
                // pese a que el tipo TS del modelo dice `number` (gotcha conocido de pg con
                // columnas DECIMAL, para no perder precisión). Number(...) sigue el mismo
                // patrón ya usado para unitCost/minPercentage/maxPercentage/percentage en este
                // archivo -- sin este cast, quotableVariantSchema.netWeightGrams (z.number()) en
                // el frontend revienta con un ZodError "expected number, received string".
                netWeightGrams: variant.sizePresentation?.netWeightGrams != null ? Number(variant.sizePresentation.netWeightGrams) : null,
                // Muestra lo que efectivamente se costea POR DEFECTO (filas fijas + el default
                // de cada grupo de opciones) -- ya NO concatena todas las alternativas, sería
                // engañoso (2026-09-21/24, ver CLAUDE.md #4). Tolerante a un grupo mal
                // configurado (ninguna fila marcada como default): simplemente lo omite acá, sin
                // reventar -- esta lista es de solo lectura para el catálogo, el
                // guard autoritativo vive en quoteService.calculateQuote.
                packagingLabel:
                    (variant.unitMaterials ?? [])
                        .filter(unitMaterial => normalizeOptionGroup(unitMaterial.optionGroup) === null || unitMaterial.isDefault)
                        .map(unitMaterial => unitMaterial.usedUnitMaterial?.displayName)
                        .filter(Boolean)
                        .join(" + ") || null,
                unitMaterialOptionGroups: buildMaterialOptionGroups(variant.unitMaterials ?? [], row => row.usedUnitMaterial),
                intermediateMaterialOptionGroups: buildMaterialOptionGroups(
                    variant.intermediateMaterials ?? [],
                    row => row.usedIntermediateMaterial
                ),
                palletMaterialOptionGroups: buildMaterialOptionGroups(variant.palletMaterials ?? [], row => row.usedPalletMaterial)
            }))
        }
    })
}

async function listQuoteDestinations(): Promise<Destination[]> {
    return Destination.findAll({ where: { isActive: true }, order: [["displayName", "ASC"]] })
}


// Una cotización guardada ya NO captura ni vincula un prospecto (2026-09-21): el flujo de cotizar
// no pide datos de contacto; los Leads siguen existiendo pero solo nacen del formulario público de
// la landing (ver lead/), sin relación con Quote.
async function saveQuote(salespersonId: number, input: CalculateQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<QuoteCalculation & { id: number; createdAt: Date }> {
    const calculation = await calculateQuote(input, language)

    const quote = await Quote.create({
        salespersonId,
        productVariantId: calculation.productVariantId,
        destinationId: calculation.destinationId,
        productDisplayName: calculation.productDisplayName,
        variantLabel: calculation.variantLabel,
        requestedPallets: calculation.requestedPallets,
        totalUnits: calculation.totalUnits,
        rawMaterialCost: calculation.rawMaterialCost,
        unitPackagingCost: calculation.unitPackagingCost,
        intermediatePackagingCost: calculation.intermediatePackagingCost,
        processingCostTotal: calculation.processingCostTotal,
        palletMaterialCost: calculation.palletMaterialCost,
        percentageCostTotal: calculation.percentageCostTotal,
        transportCost: calculation.transportCost,
        adjustmentCost: calculation.adjustmentCost,
        totalCost: calculation.totalCost,
        breakdown: calculation.breakdown
    })

    return {
        ...calculation,
        id: quote.id,
        createdAt: quote.get("createdAt") as Date
    }
}


async function listAllQuotes(): Promise<Quote[]> {
    return Quote.findAll({
        include: [
            { model: Salesperson, as: "quotingSalesperson", attributes: ["id", "name", "companyName", "email"] }
        ],
        order: [["createdAt", "DESC"]]
    })
}

export const quoteService = {
    calculateQuote,
    listQuotableProducts,
    listQuoteDestinations,
    saveQuote,
    listAllQuotes,
}
