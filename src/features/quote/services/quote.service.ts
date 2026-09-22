import { Op } from "sequelize"
import ProductVariant from "../../product/models/ProductVariant.model"
import Product from "../../product/models/Product.model"
import ProductTranslation from "../../product/models/ProductTranslation.model"
import ProductIngredient from "../../product/models/ProductIngredient.model"
import SubCategory from "../../category/models/SubCategory.model"
import Category from "../../category/models/Category.model"
import CategoryTranslation from "../../category/models/CategoryTranslation.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import IngredientTranslation from "../../ingredient/models/IngredientTranslation.model"
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
import { CalculateQuoteInput, IngredientMixLineInput } from "../schemas/quote.schema"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE, pickTranslatedName } from "../../../shared/utils/translation.util"
import { toDecimal, roundMoney, sumMoney } from "../../../shared/utils/money.util"
import Decimal from "decimal.js"

const GRAMS_PER_POUND = getUnitCatalogEntry("pound")!.baseFactor

interface RawMaterialLine {
    ingredientId: number
    displayName: string
    unitCost: number
    quantityPerUnit: number
    totalUnits: number
    lineTotal: number
}

interface UnitMaterialLine {
    packagingId: number
    displayName: string
    unitCost: number
    quantityPerUnit: number
    totalUnits: number
    lineTotal: number
}

interface IntermediatePackagingLine {
    packagingId: number
    displayName: string
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
        intermediatePackaging: IntermediatePackagingLine | null
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
// cantidad en la unidad de costeo del ingrediente -> costo. Quién define el % y cuándo queda
// congelado es la única diferencia real entre ambos caminos (ver buildFixedPercentageRawMaterials
// vs. buildCustomizableRawMaterials más abajo), así que esta función vive una sola vez.
function buildPercentageRawMaterialLine(
    ingredientId: number,
    ingredient: Ingredient,
    percentage: Decimal,
    netWeight: Decimal,
    totalUnits: number,
    totalUnitsDecimal: Decimal,
    language: ContentLanguage
): RawMaterialLine {
    const unitCost = toDecimal(ingredient?.costPerUnit ?? 0)
    if (!ingredient?.costUnit) {
        throw new AppError(422, "errors.ingredient_missing_cost_unit", { ingredientId })
    }

    if (ingredient.costUnit.unitType !== "weight") {
        throw new AppError(422, "errors.ingredient_cost_unit_type_mismatch", {
            ingredientId,
            unitType: ingredient.costUnit.unitType
        })
    }

    const costUnitBaseFactor = toDecimal(ingredient.costUnit.baseFactor)
    const gramsPerUnit = percentage.dividedBy(100).times(netWeight)
    const quantityPerUnitDecimal = gramsPerUnit.dividedBy(costUnitBaseFactor)
    const lineTotal = roundMoney(unitCost.times(quantityPerUnitDecimal).times(totalUnitsDecimal))

    return {
        ingredientId,
        displayName: pickTranslatedName(ingredient?.displayName ?? "", ingredient?.translations, language),
        unitCost: unitCost.toNumber(),
        quantityPerUnit: quantityPerUnitDecimal.toDecimalPlaces(6).toNumber(),
        totalUnits,
        lineTotal
    }
}

// Receta fija (!Product.isCustomizable): el % de cada ingrediente lo fija el admin al crear el
// producto (ProductIngredient.percentage) y el cliente nunca lo puede alterar -- calculateQuote
// jamás lee input.ingredientMix acá (ver buildRawMaterialLines). Si el producto no tiene NINGÚN
// ingrediente activo configurado todavía, se devuelve $0 sin exigir ni peso neto ni que sume 100
// -- mismo comportamiento "no configurado" que ya tenía el motor viejo con quantityValue vacío,
// para no romper variantes que todavía no tienen su receta cargada.
function buildFixedPercentageRawMaterials(
    productIngredients: ProductIngredient[],
    netWeightGrams: number,
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    if (productIngredients.length === 0) return []

    if (!netWeightGrams || netWeightGrams <= 0) {
        throw new AppError(422, "errors.presentation_missing_net_weight")
    }

    const netWeight = toDecimal(netWeightGrams)
    const totalUnitsDecimal = toDecimal(totalUnits)

    let percentageTotal = new Decimal(0)
    const rawMaterials: RawMaterialLine[] = productIngredients.map(productIngredient => {
        const percentage = toDecimal(productIngredient.percentage ?? 0)
        percentageTotal = percentageTotal.plus(percentage)

        return buildPercentageRawMaterialLine(
            productIngredient.ingredientId,
            productIngredient.usedIngredient,
            percentage,
            netWeight,
            totalUnits,
            totalUnitsDecimal,
            language
        )
    })

    // Autoritativo (a diferencia del techo "blando" de productIngredient.service.ts, que solo
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
    pool: ProductIngredient[],
    mix: IngredientMixLineInput[] | undefined,
    netWeightGrams: number,
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    if (!mix || mix.length === 0) {
        throw new AppError(422, "errors.ingredient_mix_required")
    }
    if (!netWeightGrams || netWeightGrams <= 0) {
        throw new AppError(422, "errors.presentation_missing_net_weight")
    }

    const poolByIngredientId = new Map(pool.map(productIngredient => [productIngredient.ingredientId, productIngredient]))
    const seenIngredientIds = new Set<number>()
    const netWeight = toDecimal(netWeightGrams)
    const totalUnitsDecimal = toDecimal(totalUnits)

    let percentageTotal = new Decimal(0)
    const rawMaterials: RawMaterialLine[] = mix.map(mixLine => {
        if (seenIngredientIds.has(mixLine.ingredientId)) {
            throw new AppError(422, "errors.duplicate_ingredient_in_mix", { ingredientId: mixLine.ingredientId })
        }
        seenIngredientIds.add(mixLine.ingredientId)

        const poolEntry = poolByIngredientId.get(mixLine.ingredientId)
        if (!poolEntry) {
            throw new AppError(422, "errors.ingredient_not_in_pool", { ingredientId: mixLine.ingredientId })
        }

        const minPercentage = poolEntry.minPercentage !== null && poolEntry.minPercentage !== undefined ? Number(poolEntry.minPercentage) : 0
        const maxPercentage = poolEntry.maxPercentage !== null && poolEntry.maxPercentage !== undefined ? Number(poolEntry.maxPercentage) : 100
        if (mixLine.percentage < minPercentage || mixLine.percentage > maxPercentage) {
            throw new AppError(422, "errors.ingredient_percentage_out_of_range", {
                ingredientId: mixLine.ingredientId,
                minPercentage,
                maxPercentage
            })
        }

        const percentage = toDecimal(mixLine.percentage)
        percentageTotal = percentageTotal.plus(percentage)

        return buildPercentageRawMaterialLine(
            mixLine.ingredientId,
            poolEntry.usedIngredient,
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
                        model: ProductIngredient,
                        as: "productIngredients",
                        where: { isActive: true },
                        required: false,
                        include: [
                            {
                                model: Ingredient,
                                as: "usedIngredient",
                                include: [
                                    { model: Unit, as: "costUnit" },
                                    { model: IngredientTranslation, as: "translations" }
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
                // Default + opcional (2026-09-21): reemplaza el FK único
                // usedIntermediatePackaging -- se cargan TODAS las filas activas (fijas +
                // swappable), nunca solo isDefault:true, porque resolveIntermediateMaterialForQuote
                // necesita el set completo para validar la elección del cliente (ver comentario
                // ahí).
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
    // El cliente nunca puede alterar una receta fija: input.ingredientMix ni siquiera se lee acá
    // en ese caso -- los % vienen únicamente de ProductIngredient.percentage (fijados por el
    // admin), ver buildFixedPercentageRawMaterials.
    return variant.parentProduct?.isCustomizable
        ? buildCustomizableRawMaterials(
              variant.parentProduct.productIngredients ?? [],
              input.ingredientMix,
              netWeightGrams,
              totalUnits,
              language
          )
        : buildFixedPercentageRawMaterials(variant.parentProduct?.productIngredients ?? [], netWeightGrams, totalUnits, language)
}

interface SwappableMaterialRow {
    // Opcional, no solo number -- sequelize-typescript tipa Model.id como opcional (una instancia
    // sin guardar aún no tiene id), aunque en la práctica cualquier fila leída de la BD siempre lo
    // trae.
    id?: number
    isSwappable: boolean
    isDefault: boolean
}

// Default + opcional (2026-09-21, ver CLAUDE.md #4): comparte la misma lógica de resolución para
// empaque individual y paletización (ambos niveles "receta" -- N filas incondicionales que SIEMPRE
// se costean, más como mucho un slot swappable del que se costea solo UNA fila: la elegida por el
// cliente, o si no eligió nada, la marcada isDefault). Nunca confía en el id que manda el cliente
// sin validar que sea una fila swappable de ESTE SKU -- mismo principio que
// buildCustomizableRawMaterials/poolByIngredientId con la mezcla de ingredientes.
function resolveMaterialsForQuote<T extends SwappableMaterialRow>(
    allRows: T[],
    selectedId: number | undefined,
    invalidSelectionKey: string,
    defaultNotConfiguredKey: string
): T[] {
    const fixedRows = allRows.filter(row => !row.isSwappable)
    const swappableRows = allRows.filter(row => row.isSwappable)
    if (swappableRows.length === 0) return fixedRows // camino legado, sin filas swappable -- comportamiento sin cambios

    if (selectedId !== undefined) {
        const chosen = swappableRows.find(row => row.id === selectedId)
        if (!chosen) throw new AppError(422, invalidSelectionKey, { selectedId })
        return [...fixedRows, chosen]
    }

    const defaultRow = swappableRows.find(row => row.isDefault)
    if (!defaultRow) throw new AppError(422, defaultNotConfiguredKey)
    return [...fixedRows, defaultRow]
}

// Empaque intermedio (2026-09-21): a diferencia de unit/pallet, este nivel nunca fue una receta de
// varios componentes -- es "la bolsa/saco grande", un único material a la vez (0 o 1). El join
// table nuevo (ProductVariantIntermediateMaterial, reemplaza el FK usedIntermediatePackaging)
// preserva esa forma: si hay filas swappable, se resuelve UNA sola (elegida o default); si no hay
// ninguna swappable, se toma la única fila fija (0 o 1, igual que el FK viejo -- más de una revienta).
function resolveIntermediateMaterialForQuote(
    allRows: ProductVariantIntermediateMaterial[],
    selectedId: number | undefined
): ProductVariantIntermediateMaterial | null {
    const swappableRows = allRows.filter(row => row.isSwappable)
    const fixedRows = allRows.filter(row => !row.isSwappable)

    // Defensa en profundidad del guard de escritura (productVariantIntermediateMaterial.service.ts::
    // assertAtMostOneFixedRow): dos filas fijas se costearían en silencio como una sola (subcosteo).
    // Se rechaza en vez de "tomar la primera".
    if (fixedRows.length > 1) throw new AppError(422, "errors.multiple_fixed_intermediate_materials")

    if (swappableRows.length === 0) return fixedRows[0] ?? null

    if (selectedId !== undefined) {
        const chosen = swappableRows.find(row => row.id === selectedId)
        if (!chosen) throw new AppError(422, "errors.invalid_intermediate_material_selection", { selectedId })
        return chosen
    }

    const defaultRow = swappableRows.find(row => row.isDefault)
    if (!defaultRow) throw new AppError(422, "errors.intermediate_material_default_not_configured")
    return defaultRow
}

function buildIntermediatePackagingLine(
    variant: ProductVariant,
    resolvedMaterial: ProductVariantIntermediateMaterial | null,
    totalUnits: number
): IntermediatePackagingLine | null {
    if (!resolvedMaterial) return null

    if (!variant.unitsPerIntermediatePackage || variant.unitsPerIntermediatePackage <= 0) {
        throw new AppError(422, "errors.intermediate_packaging_missing_units")
    }
    const unitCost = toDecimal(resolvedMaterial.usedIntermediateMaterial?.unitCost ?? 0)
    const packagesNeeded = Math.ceil(totalUnits / variant.unitsPerIntermediatePackage)
    return {
        packagingId: resolvedMaterial.packagingId,
        displayName: resolvedMaterial.usedIntermediateMaterial?.displayName ?? "",
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

    const resolvedUnitMaterials = resolveMaterialsForQuote(
        variant.unitMaterials ?? [],
        input.selectedUnitMaterialId,
        "errors.invalid_unit_material_selection",
        "errors.unit_material_default_not_configured"
    )
    const unitMaterials: UnitMaterialLine[] = resolvedUnitMaterials.map(unitMaterial => {
        const unitCost = toDecimal(unitMaterial.usedUnitMaterial?.unitCost ?? 0)
        const quantityPerUnit = toDecimal(unitMaterial.quantityPerUnit ?? 1)
        const lineTotal = roundMoney(unitCost.times(quantityPerUnit).times(totalUnits))
        return {
            packagingId: unitMaterial.packagingId,
            displayName: unitMaterial.usedUnitMaterial?.displayName ?? "",
            unitCost: unitCost.toNumber(),
            quantityPerUnit: quantityPerUnit.toNumber(),
            totalUnits,
            lineTotal
        }
    })
    const unitPackagingCost = sumMoney(unitMaterials.map(line => line.lineTotal))

    const resolvedIntermediateMaterial = resolveIntermediateMaterialForQuote(
        variant.intermediateMaterials ?? [],
        input.selectedIntermediateMaterialId
    )
    const intermediatePackaging = buildIntermediatePackagingLine(variant, resolvedIntermediateMaterial, totalUnits)
    const intermediatePackagingCost = intermediatePackaging?.lineTotal ?? 0

    const processingCosts = await buildPerWeightProcessingCostLines(variant, totalUnits, language)
    const processingCostTotal = sumMoney(processingCosts.map(line => line.lineTotal))

    const resolvedPalletMaterials = resolveMaterialsForQuote(
        variant.palletMaterials ?? [],
        input.selectedPalletMaterialId,
        "errors.invalid_pallet_material_selection",
        "errors.pallet_material_default_not_configured"
    )
    const palletMaterials: PalletMaterialLine[] = resolvedPalletMaterials.map(palletMaterial => {
        const unitCost = toDecimal(palletMaterial.usedPalletMaterial?.unitCost ?? 0)
        const quantityPerPallet = toDecimal(palletMaterial.quantityValue ?? 0)
        const lineTotal = roundMoney(unitCost.times(quantityPerPallet).times(requestedPallets))
        return {
            packagingId: palletMaterial.packagingId,
            displayName: palletMaterial.usedPalletMaterial?.displayName ?? "",
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
            intermediatePackaging,
            processingCosts,
            palletMaterials,
            percentageCosts,
            transport,
            adjustment,
            language
        }
    }
}

// Default + opcional (2026-09-21, ver CLAUDE.md #4): el menú de alternativas de un nivel para
// que el cliente elija al cotizar -- solo filas isSwappable=true (las incondicionales nunca son
// una "opción", siempre se costean solas). `id` es el id de la FILA del join
// (ProductVariantUnitMaterial/IntermediateMaterial/PalletMaterial), el mismo que
// calculateQuoteSchema.selectedXMaterialId espera -- no el packagingId.
interface QuotableMaterialOption {
    id: number
    packagingId: number
    displayName: string
    unitCost: number
    isDefault: boolean
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
    unitMaterialOptions: QuotableMaterialOption[]
    intermediateMaterialOptions: QuotableMaterialOption[]
    palletMaterialOptions: QuotableMaterialOption[]
}

interface QuotableIngredientOption {
    ingredientId: number
    displayName: string
    isOrganic: boolean
    minPercentage: number
    maxPercentage: number
}

// Receta fija (!isCustomizable): el % lo fija el admin y el cliente nunca lo puede alterar (ver
// buildFixedPercentageRawMaterials en este mismo archivo) -- pero SÍ debe poder VER qué está
// cotizando (ej. "100% Piña" / "50% Banano · 50% Fresa"). Distinto de QuotableIngredientOption
// (el pool editable del mix personalizable) a propósito: son conceptos diferentes, no la misma
// forma con un campo de más.
interface QuotableFixedIngredient {
    ingredientId: number
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
    ingredientPool: QuotableIngredientOption[]
    fixedRecipe: QuotableFixedIngredient[]
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
                model: ProductIngredient,
                as: "productIngredients",
                required: false,
                where: { isActive: true },
                include: [{
                    model: Ingredient,
                    as: "usedIngredient",
                    include: [{ model: IngredientTranslation, as: "translations" }]
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
            ingredientPool: plain.isCustomizable
                ? (plain.productIngredients ?? []).map((productIngredient: ProductIngredient) => ({
                      ingredientId: productIngredient.ingredientId,
                      displayName: pickTranslatedName(productIngredient.usedIngredient?.displayName ?? "", productIngredient.usedIngredient?.translations, language),
                      isOrganic: productIngredient.usedIngredient?.isOrganic ?? false,
                      minPercentage: productIngredient.minPercentage !== null && productIngredient.minPercentage !== undefined
                          ? Number(productIngredient.minPercentage)
                          : 0,
                      maxPercentage: productIngredient.maxPercentage !== null && productIngredient.maxPercentage !== undefined
                          ? Number(productIngredient.maxPercentage)
                          : 100
                  }))
                : [],
            // El cliente no puede editar una receta fija, pero sí debe ver qué está cotizando --
            // ver comentario de QuotableFixedIngredient arriba.
            fixedRecipe: plain.isCustomizable
                ? []
                : (plain.productIngredients ?? []).map((productIngredient: ProductIngredient) => ({
                      ingredientId: productIngredient.ingredientId,
                      displayName: pickTranslatedName(productIngredient.usedIngredient?.displayName ?? "", productIngredient.usedIngredient?.translations, language),
                      percentage: productIngredient.percentage !== null && productIngredient.percentage !== undefined
                          ? Number(productIngredient.percentage)
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
                // Muestra lo que efectivamente se costea POR DEFECTO (filas incondicionales +
                // la swappable marcada isDefault, si hay alguna) -- ya NO concatena todas las
                // alternativas, sería engañoso (2026-09-21, ver CLAUDE.md #4). Tolerante a un
                // nivel mal configurado (ninguna swappable marcada como default): simplemente la
                // omite acá, sin reventar -- esta lista es de solo lectura para el catálogo, el
                // guard autoritativo vive en quoteService.calculateQuote.
                packagingLabel:
                    (variant.unitMaterials ?? [])
                        .filter(unitMaterial => !unitMaterial.isSwappable || unitMaterial.isDefault)
                        .map(unitMaterial => unitMaterial.usedUnitMaterial?.displayName)
                        .filter(Boolean)
                        .join(" + ") || null,
                unitMaterialOptions: (variant.unitMaterials ?? [])
                    .filter(unitMaterial => unitMaterial.isSwappable)
                    .map(unitMaterial => ({
                        id: unitMaterial.id,
                        packagingId: unitMaterial.packagingId,
                        displayName: unitMaterial.usedUnitMaterial?.displayName ?? "",
                        unitCost: Number(unitMaterial.usedUnitMaterial?.unitCost ?? 0),
                        isDefault: unitMaterial.isDefault
                    })),
                intermediateMaterialOptions: (variant.intermediateMaterials ?? [])
                    .filter(material => material.isSwappable)
                    .map(material => ({
                        id: material.id,
                        packagingId: material.packagingId,
                        displayName: material.usedIntermediateMaterial?.displayName ?? "",
                        unitCost: Number(material.usedIntermediateMaterial?.unitCost ?? 0),
                        isDefault: material.isDefault
                    })),
                palletMaterialOptions: (variant.palletMaterials ?? [])
                    .filter(material => material.isSwappable)
                    .map(material => ({
                        id: material.id,
                        packagingId: material.packagingId,
                        displayName: material.usedPalletMaterial?.displayName ?? "",
                        unitCost: Number(material.usedPalletMaterial?.unitCost ?? 0),
                        isDefault: material.isDefault
                    }))
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
