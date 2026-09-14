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
import ProductType from "../../product-type/models/ProductType.model"
import Destination from "../../destination/models/Destination.model"
import Customer from "../../customer/models/Customer.model"
import Quote from "../models/Quote.model"
import Lead from "../../lead/models/Lead.model"
import { leadService } from "../../lead/services/lead.service"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import ProcessingCostTranslation from "../../processingCost/models/ProcessingCostTranslation.model"
import { getUnitCatalogEntry } from "../../unit/constants/unitCatalog"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CalculateQuoteInput, IngredientMixLineInput, SaveQuoteInput } from "../schemas/quote.schema"
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

function buildFixedRecipeRawMaterials(
    productIngredients: ProductIngredient[],
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    const totalUnitsDecimal = toDecimal(totalUnits)

    return productIngredients.map(productIngredient => {
        const ingredient = productIngredient.usedIngredient
        const unitCost = toDecimal(ingredient?.costPerUnit ?? 0)
        const rawQuantity = toDecimal(productIngredient.quantityValue ?? 0)
        const quantityUnit = productIngredient.quantityUnit
        const costUnit = ingredient?.costUnit

        let quantityPerUnit = rawQuantity
        if (quantityUnit && costUnit) {
            if (quantityUnit.unitType !== costUnit.unitType) {
                throw new AppError(422, "errors.product_ingredient_quantity_unit_type_mismatch", {
                    ingredientId: productIngredient.ingredientId,
                    quantityUnitType: quantityUnit.unitType,
                    costUnitType: costUnit.unitType
                })
            }
            quantityPerUnit = rawQuantity.times(toDecimal(quantityUnit.baseFactor)).dividedBy(toDecimal(costUnit.baseFactor))
        }

        const lineTotal = roundMoney(unitCost.times(quantityPerUnit).times(totalUnitsDecimal))

        return {
            ingredientId: productIngredient.ingredientId,
            displayName: pickTranslatedName(ingredient?.displayName ?? "", ingredient?.translations, language),
            unitCost: unitCost.toNumber(),
            quantityPerUnit: quantityPerUnit.toDecimalPlaces(6).toNumber(),
            totalUnits,
            lineTotal
        }
    })
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

        const ingredient = poolEntry.usedIngredient
        const unitCost = toDecimal(ingredient?.costPerUnit ?? 0)
        if (!ingredient?.costUnit) {
            throw new AppError(422, "errors.ingredient_missing_cost_unit", { ingredientId: mixLine.ingredientId })
        }
 
        if (ingredient.costUnit.unitType !== "weight") {
            throw new AppError(422, "errors.ingredient_cost_unit_type_mismatch", {
                ingredientId: mixLine.ingredientId,
                unitType: ingredient.costUnit.unitType
            })
        }

        const costUnitBaseFactor = toDecimal(ingredient.costUnit.baseFactor)
        const gramsPerUnit = percentage.dividedBy(100).times(netWeight)
        const quantityPerUnitDecimal = gramsPerUnit.dividedBy(costUnitBaseFactor)
        const lineTotal = roundMoney(unitCost.times(quantityPerUnitDecimal).times(totalUnitsDecimal))

        return {
            ingredientId: mixLine.ingredientId,
            displayName: pickTranslatedName(ingredient?.displayName ?? "", ingredient?.translations, language),
            unitCost: unitCost.toNumber(),
            quantityPerUnit: quantityPerUnitDecimal.toDecimalPlaces(6).toNumber(),
            totalUnits,
            lineTotal
        }
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
                            },
                            { model: Unit, as: "quantityUnit" }
                        ]
                    },
                    { model: ProductTranslation, as: "translations" }
                ]
            },
            { model: Presentation, as: "sizePresentation" },
            { model: Packaging, as: "usedIntermediatePackaging" },
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
    return variant.parentProduct?.isCustomizable
        ? buildCustomizableRawMaterials(
              variant.parentProduct.productIngredients ?? [],
              input.ingredientMix,
              Number(variant.sizePresentation?.netWeightGrams ?? 0),
              totalUnits,
              language
          )
        : buildFixedRecipeRawMaterials(variant.parentProduct?.productIngredients ?? [], totalUnits, language)
}

function buildIntermediatePackagingLine(variant: ProductVariant, totalUnits: number): IntermediatePackagingLine | null {
    if (!variant.usedIntermediatePackaging) return null

    if (!variant.unitsPerIntermediatePackage || variant.unitsPerIntermediatePackage <= 0) {
        throw new AppError(422, "errors.intermediate_packaging_missing_units")
    }
    const unitCost = toDecimal(variant.usedIntermediatePackaging.unitCost ?? 0)
    const packagesNeeded = Math.ceil(totalUnits / variant.unitsPerIntermediatePackage)
    return {
        packagingId: variant.usedIntermediatePackaging.id,
        displayName: variant.usedIntermediatePackaging.displayName,
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

    const unitMaterials: UnitMaterialLine[] = (variant.unitMaterials ?? []).map(unitMaterial => {
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

    const intermediatePackaging = buildIntermediatePackagingLine(variant, totalUnits)
    const intermediatePackagingCost = intermediatePackaging?.lineTotal ?? 0

    const processingCosts = await buildPerWeightProcessingCostLines(variant, totalUnits, language)
    const processingCostTotal = sumMoney(processingCosts.map(line => line.lineTotal))

    const palletMaterials: PalletMaterialLine[] = (variant.palletMaterials ?? []).map(palletMaterial => {
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

interface QuotableVariant {
    id: number
    skuCode: string | null
    boxesPerPallet: number
    bagsPerBox: number
    presentationLabel: string | null
    packagingLabel: string | null
}

interface QuotableIngredientOption {
    ingredientId: number
    displayName: string
    isOrganic: boolean
    minPercentage: number
    maxPercentage: number
}

interface QuotableProduct {
    id: number
    displayName: string
    isOrganic: boolean
    isCustomizable: boolean
    productTypeName: string | null
    imageUrl: string | null
    categoryId: number
    categoryName: string
    categoryImageUrl: string | null
    ingredientPool: QuotableIngredientOption[]
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
                where: { isActive: true, boxesPerPallet: { [Op.not]: null }, bagsPerBox: { [Op.not]: null } },
                include: [
                    { model: Presentation, as: "sizePresentation" },
                    {
                        model: ProductVariantUnitMaterial,
                        as: "unitMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [{ model: Packaging, as: "usedUnitMaterial" }]
                    }
                ]
            },
            { model: ProductType, as: "parentProductType" },
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
            productTypeName: plain.parentProductType?.displayName ?? null,
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
            variants: (plain.productVariants ?? []).map((variant: ProductVariant) => ({
                id: variant.id,
                skuCode: variant.skuCode ?? null,
                boxesPerPallet: variant.boxesPerPallet as number,
                bagsPerBox: variant.bagsPerBox as number,
                presentationLabel: variant.sizePresentation?.displayLabel ?? null,
                packagingLabel:
                    (variant.unitMaterials ?? [])
                        .map(unitMaterial => unitMaterial.usedUnitMaterial?.displayName)
                        .filter(Boolean)
                        .join(" + ") || null
            }))
        }
    })
}

async function listQuoteDestinations(): Promise<Destination[]> {
    return Destination.findAll({ where: { isActive: true }, order: [["displayName", "ASC"]] })
}


async function saveQuote(customerId: number, input: SaveQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<QuoteCalculation & { id: number; createdAt: Date; leadId: number }> {
    const calculation = await calculateQuote(input, language)
    const lead = await leadService.findOrCreateLeadForQuote(input.leadContact)

    const quote = await Quote.create({
        customerId,
        leadId: lead.id,
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
        createdAt: quote.get("createdAt") as Date,
        leadId: lead.id
    }
}


async function listAllQuotes(): Promise<Quote[]> {
    return Quote.findAll({
        include: [
            { model: Customer, as: "quotingCustomer", attributes: ["id", "name", "companyName", "email"] },
            { model: Lead, as: "quotedLead", required: false, attributes: ["id", "fullName", "companyName", "email"] }
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
