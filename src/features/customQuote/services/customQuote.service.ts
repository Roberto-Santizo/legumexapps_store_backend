import { Op } from "sequelize"
import Decimal from "decimal.js"
import CustomQuoteRawMaterialOption from "../models/CustomQuoteRawMaterialOption.model"
import CustomQuoteIngredientOption from "../models/CustomQuoteIngredientOption.model"
import CustomQuotePresentationOption from "../models/CustomQuotePresentationOption.model"
import CustomQuotePackagingOption from "../models/CustomQuotePackagingOption.model"
import CustomQuote, { CustomQuoteStatus } from "../models/CustomQuote.model"
import SubCategory from "../../category/models/SubCategory.model"
import Presentation from "../../presentation/models/Presentation.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../../rawMaterial/models/RawMaterialTranslation.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import IngredientTranslation from "../../ingredient/models/IngredientTranslation.model"
import Unit from "../../unit/models/Unit.model"
import Packaging from "../../packaging/models/Packaging.model"
import Destination from "../../destination/models/Destination.model"
import type { QuoteCalculation } from "../../quote/services/quote.service"
import {
    IngredientLine,
    IntermediateMaterialLine,
    PalletMaterialLine,
    UnitMaterialLine,
    assembleQuoteTotals,
    buildAdjustmentLine,
    buildCustomizableRawMaterials,
    buildIngredientLine,
    buildIntermediateMaterialLine,
    buildPalletMaterialLine,
    buildPerWeightProcessingCostLines,
    buildTransportLine,
    buildUnitMaterialLine
} from "../../quote/services/quoteCostLines"
import { MaterialLevel, resolveMaterialsForQuote } from "../../quote/services/quoteMaterialSelection"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { toDecimal, sumMoney } from "../../../shared/utils/money.util"
import { normalizeOptionGroup } from "../../../shared/utils/optionGroup.util"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE, pickTranslatedName } from "../../../shared/utils/translation.util"
import { CustomQuoteQuantityBasis } from "../constants/customQuoteConfig.constant"
import { CustomQuoteCalculationInput } from "../schemas/customQuote.schema"

// Motor de "Cotizaciones a la medida" (World 2): cotiza un producto que no existe (sin SKU) a partir
// de lo que armó el representante + las listas de permitidos del admin. NO tiene matemática propia:
// cada línea sale de los MISMOS builders que calculateQuote (quoteCostLines.ts), la receta del mismo
// buildCustomizableRawMaterials y la elección de empaques del mismo resolveMaterialsForQuote -- lo
// único distinto es de dónde salen los valores (listas de permitidos en vez de un ProductVariant).
// calculateCustomQuote solo calcula: nunca escribe en ninguna tabla (Quote, QuoteDraft, Product,
// ProductVariant incluidas). saveCustomQuote recalcula y escribe SOLO en customQuotes.

const GRAMS_PER_KILOGRAM = new Decimal(1000)

export interface CustomQuoteConfiguration {
    subCategoryId: number
    presentationId: number
    isOrganic: boolean
    requestedPallets: number
    destinationId: number | null
    rawMaterialMix: { rawMaterialId: number; percentage: number }[]
    ingredients: { ingredientId: number; gramsPerUnit: number }[]
    pallet: { boxesPerPallet: number; bagsPerBox: number; unitsPerIntermediatePackage: number | null }
    // Lo que efectivamente se costeó por nivel (fijas + una por grupo), con la cantidad resuelta --
    // suficiente para reproducir/fabricar el producto sin volver a leer las listas.
    packaging: Record<MaterialLevel, ResolvedPackagingConfiguration[]>
}

interface ResolvedPackagingConfiguration {
    packagingOptionId: number
    packagingId: number
    optionGroup: string | null
    quantity: number | null
    quantityBasis: CustomQuoteQuantityBasis | null
}

// Misma forma que QuoteCalculation (mismo breakdown, mismas columnas de costo) salvo que no hay SKU.
export type CustomQuoteCalculation = Omit<QuoteCalculation, "productVariantId"> & {
    subCategoryId: number
    presentationId: number
    isOrganic: boolean
    bagsPerBox: number
    unitsPerIntermediatePackage: number | null
    configuration: CustomQuoteConfiguration
}

// ---- Carga de las listas de permitidos (solo filas activas cuyo elemento de catálogo sigue activo) ----

async function loadPresentationOption(presentationId: number): Promise<CustomQuotePresentationOption> {
    const option = await CustomQuotePresentationOption.findOne({
        where: { presentationId, isActive: true },
        include: [{ model: Presentation, as: "presentation", where: { isActive: true }, required: true }]
    })
    if (!option) throw new AppError(422, "errors.custom_quote_presentation_not_offered", { presentationId })
    return option
}

async function assertSubCategoryIsActive(subCategoryId: number): Promise<void> {
    const subCategory = await SubCategory.findOne({ where: { id: subCategoryId, isActive: true } })
    if (!subCategory) throw new NotFoundError("SubCategory", subCategoryId)
}

async function loadRawMaterialOptions(subCategoryId: number): Promise<CustomQuoteRawMaterialOption[]> {
    return CustomQuoteRawMaterialOption.findAll({
        where: { subCategoryId, isActive: true },
        include: [{
            model: RawMaterial,
            as: "usedRawMaterial",
            where: { isActive: true },
            required: true,
            include: [
                { model: Unit, as: "costUnit" },
                { model: RawMaterialTranslation, as: "translations" }
            ]
        }]
    })
}

async function loadIngredientOptions(ingredientIds: number[]): Promise<CustomQuoteIngredientOption[]> {
    if (ingredientIds.length === 0) return []
    return CustomQuoteIngredientOption.findAll({
        where: { ingredientId: { [Op.in]: ingredientIds }, isActive: true },
        include: [{
            model: Ingredient,
            as: "usedIngredient",
            where: { isActive: true },
            required: true,
            include: [
                { model: Unit, as: "costUnit" },
                { model: IngredientTranslation, as: "translations" }
            ]
        }]
    })
}

async function loadPackagingOptions(): Promise<CustomQuotePackagingOption[]> {
    return CustomQuotePackagingOption.findAll({
        where: { isActive: true },
        include: [{ model: Packaging, as: "packaging", where: { isActive: true }, required: true }]
    })
}

async function resolveDestination(destinationId: number | undefined): Promise<Destination | null> {
    if (!destinationId) return null
    const destination = await Destination.findOne({ where: { id: destinationId, isActive: true } })
    if (!destination) throw new NotFoundError("Destination", destinationId)
    return destination
}

// ---- Validación de la receta (antes del builder compartido, con claves propias de este flujo) ----

// buildCustomizableRawMaterials ya exige: mezcla no vacía, sin duplicados, solo materias primas del
// pool, cada % dentro de su mínimo/máximo, total 100 ± 0.5 y unidad de costo por peso. Acá se suma lo
// que en productos definidos se valida al configurar el producto: mezclable si hay más de una, y
// compatible con orgánico si se pidió orgánico (misma regla que productRawMaterial.service.ts:
// variante orgánica o insumo tipo "other").
function assertRecipeIsAllowed(
    input: CustomQuoteCalculationInput,
    rawMaterialOptions: CustomQuoteRawMaterialOption[],
    language: ContentLanguage
): void {
    const optionByRawMaterialId = new Map(rawMaterialOptions.map(option => [option.rawMaterialId, option]))
    const isMix = input.rawMaterialMix.length > 1

    for (const line of input.rawMaterialMix) {
        const rawMaterial = optionByRawMaterialId.get(line.rawMaterialId)?.usedRawMaterial
        if (!rawMaterial) {
            throw new AppError(422, "errors.custom_quote_raw_material_not_offered", { rawMaterialId: line.rawMaterialId })
        }
        const rawMaterialName = pickTranslatedName(rawMaterial.displayName, rawMaterial.translations, language)
        if (isMix && !rawMaterial.isMixable) {
            throw new AppError(422, "errors.custom_quote_raw_material_not_mixable", { rawMaterial: rawMaterialName })
        }
        if (input.isOrganic && !rawMaterial.isOrganic && rawMaterial.ingredientType !== "other") {
            throw new AppError(422, "errors.custom_quote_raw_material_not_organic_compatible", { rawMaterial: rawMaterialName })
        }
    }
}

// ---- Ingredientes agregados ----

// El representante manda gramos por UNIDAD de la presentación elegida; se costean con el MISMO
// buildIngredientLine que productos definidos, usando el peso neto de la presentación como peso de
// referencia (así el % es gramos / peso neto, exactamente lo que el admin guarda como "grams en
// referenceNetWeightGrams").
function buildCustomIngredientLines(
    input: CustomQuoteCalculationInput,
    ingredientOptions: CustomQuoteIngredientOption[],
    netWeightGrams: number,
    totalUnits: number,
    language: ContentLanguage
): IngredientLine[] {
    const optionByIngredientId = new Map(ingredientOptions.map(option => [option.ingredientId, option]))
    const netWeight = toDecimal(netWeightGrams)
    const totalUnitsDecimal = toDecimal(totalUnits)
    const seenIngredientIds = new Set<number>()

    return input.ingredients.map(line => {
        if (seenIngredientIds.has(line.ingredientId)) {
            throw new AppError(422, "errors.custom_quote_duplicate_ingredient", { ingredientId: line.ingredientId })
        }
        seenIngredientIds.add(line.ingredientId)

        const option = optionByIngredientId.get(line.ingredientId)
        if (!option) throw new AppError(422, "errors.custom_quote_ingredient_not_offered", { ingredientId: line.ingredientId })
        const ingredientName = pickTranslatedName(option.usedIngredient.displayName, option.usedIngredient.translations, language)

        const gramsPerUnit = toDecimal(line.gramsPerUnit)
        if (gramsPerUnit.greaterThan(netWeight)) {
            throw new AppError(422, "errors.custom_quote_ingredient_exceeds_net_weight", { ingredient: ingredientName, netWeightGrams })
        }
        if (option.maxGramsPerKg !== null && option.maxGramsPerKg !== undefined) {
            const gramsPerKilogram = gramsPerUnit.dividedBy(netWeight).times(GRAMS_PER_KILOGRAM)
            if (gramsPerKilogram.greaterThan(toDecimal(option.maxGramsPerKg))) {
                throw new AppError(422, "errors.custom_quote_ingredient_exceeds_cap", {
                    ingredient: ingredientName,
                    maxGramsPerKg: Number(option.maxGramsPerKg)
                })
            }
        }

        return buildIngredientLine(
            line.ingredientId,
            option.usedIngredient,
            line.gramsPerUnit,
            netWeightGrams,
            netWeight,
            totalUnits,
            totalUnitsDecimal,
            language
        )
    })
}

// ---- Empaques ----

function requireQuantity(option: CustomQuotePackagingOption): Decimal {
    // El servicio de la lista no deja guardar una fila unit/pallet sin cantidad; esto solo protege
    // contra un dato corrupto, para no costear un material en $0 en silencio.
    if (option.quantity === null || option.quantity === undefined) {
        throw new AppError(422, "errors.custom_quote_packaging_quantity_missing", { packagingId: option.packagingId })
    }
    return toDecimal(option.quantity)
}

// Cantidad por palet de una fila de paletización: "por caja" se multiplica por las cajas por palet de
// la presentación elegida (una caja por caja = boxesPerPallet cajas por palet).
function palletQuantityPerPallet(option: CustomQuotePackagingOption, boxesPerPallet: number): string {
    const quantity = requireQuantity(option)
    return (option.quantityBasis === "per_box" ? quantity.times(boxesPerPallet) : quantity).toString()
}

function toPackagingConfiguration(option: CustomQuotePackagingOption): ResolvedPackagingConfiguration {
    return {
        packagingOptionId: option.id,
        packagingId: option.packagingId,
        optionGroup: normalizeOptionGroup(option.optionGroup),
        quantity: option.quantity === null || option.quantity === undefined ? null : Number(option.quantity),
        quantityBasis: option.quantityBasis ?? null,
    }
}

function bucketPackagingOptionsByLevel(options: CustomQuotePackagingOption[]): Record<MaterialLevel, CustomQuotePackagingOption[]> {
    const byLevel: Record<MaterialLevel, CustomQuotePackagingOption[]> = { unit: [], intermediate: [], pallet: [] }
    for (const option of options) {
        const level = option.packaging?.packagingRole as MaterialLevel
        if (level in byLevel) byLevel[level].push(option)
    }
    return byLevel
}

function resolvePackaging(
    input: CustomQuoteCalculationInput,
    packagingOptions: CustomQuotePackagingOption[],
    hasIntermediateLevel: boolean
): Record<MaterialLevel, CustomQuotePackagingOption[]> {
    const byLevel = bucketPackagingOptionsByLevel(packagingOptions)

    const unit = resolveMaterialsForQuote(byLevel.unit, input.selectedUnitPackagingOptionIds, "unit")
    if (unit.length === 0) throw new AppError(422, "errors.custom_quote_unit_packaging_not_configured")

    const pallet = resolveMaterialsForQuote(byLevel.pallet, input.selectedPalletPackagingOptionIds, "pallet")
    if (pallet.length === 0) throw new AppError(422, "errors.custom_quote_pallet_packaging_not_configured")

    // Una presentación ofrecida sin unidades por empaque intermedio no tiene ese nivel: nada del nivel
    // intermedio se costea (ni las filas fijas), y elegir una opción intermedia es un error.
    let intermediate: CustomQuotePackagingOption[] = []
    if (hasIntermediateLevel) {
        intermediate = resolveMaterialsForQuote(byLevel.intermediate, input.selectedIntermediatePackagingOptionIds, "intermediate")
    } else if ((input.selectedIntermediatePackagingOptionIds ?? []).length > 0) {
        throw new AppError(422, "errors.custom_quote_presentation_has_no_intermediate")
    }

    return { unit, intermediate, pallet }
}

// ---- Etiquetas ----

function buildDisplayName(rawMaterialLines: { displayName: string }[], mix: { percentage: number }[], language: ContentLanguage): string {
    const prefix = language === "en" ? "Custom" : "A la medida"
    const composition = rawMaterialLines.map((line, index) => `${mix[index].percentage}% ${line.displayName}`).join(" · ")
    return `${prefix} · ${composition}`.slice(0, 150)
}

// Mismo formato que buildVariantLabel de productos definidos.
function buildVariantLabel(presentation: Presentation, boxesPerPallet: number, bagsPerBox: number, language: ContentLanguage): string {
    const unitsPerBoxLabel = language === "en" ? `${bagsPerBox} units` : `${bagsPerBox} und`
    const sizePart = presentation.displayLabel ? `${unitsPerBoxLabel} × ${presentation.displayLabel}` : unitsPerBoxLabel
    const boxesPerPalletLabel = language === "en" ? `${boxesPerPallet} boxes/pallet` : `${boxesPerPallet} cajas/palet`
    return [sizePart, boxesPerPalletLabel].join(" · ")
}

// ---- Motor ----

async function calculateCustomQuote(
    input: CustomQuoteCalculationInput,
    language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE
): Promise<CustomQuoteCalculation> {
    const presentationOption = await loadPresentationOption(input.presentationId)
    await assertSubCategoryIsActive(input.subCategoryId)
    const [rawMaterialOptions, ingredientOptions, packagingOptions, destination] = await Promise.all([
        loadRawMaterialOptions(input.subCategoryId),
        loadIngredientOptions(input.ingredients.map(line => line.ingredientId)),
        loadPackagingOptions(),
        resolveDestination(input.destinationId),
    ])

    const presentation = presentationOption.presentation
    const netWeightGrams = Number(presentation.netWeightGrams ?? 0)
    const { boxesPerPallet, bagsPerBox } = presentationOption
    const unitsPerIntermediatePackage = presentationOption.unitsPerIntermediatePackage ?? null
    const requestedPallets = input.requestedPallets
    const totalUnits = requestedPallets * boxesPerPallet * bagsPerBox

    assertRecipeIsAllowed(input, rawMaterialOptions, language)
    const rawMaterials = buildCustomizableRawMaterials(rawMaterialOptions, input.rawMaterialMix, netWeightGrams, totalUnits, language)
    const rawMaterialCost = sumMoney(rawMaterials.map(line => line.lineTotal))

    const ingredients = buildCustomIngredientLines(input, ingredientOptions, netWeightGrams, totalUnits, language)
    const ingredientCost = sumMoney(ingredients.map(line => line.lineTotal))

    const resolved = resolvePackaging(input, packagingOptions, unitsPerIntermediatePackage !== null)

    const unitMaterials: UnitMaterialLine[] = resolved.unit.map(option =>
        buildUnitMaterialLine(option.packagingId, option.packaging, option.optionGroup, requireQuantity(option).toString(), totalUnits)
    )
    const unitPackagingCost = sumMoney(unitMaterials.map(line => line.lineTotal))

    const intermediateMaterials: IntermediateMaterialLine[] = resolved.intermediate.map(option =>
        buildIntermediateMaterialLine(option.packagingId, option.packaging, option.optionGroup, unitsPerIntermediatePackage, totalUnits)
    )
    const intermediatePackagingCost = sumMoney(intermediateMaterials.map(line => line.lineTotal))

    const processingCosts = await buildPerWeightProcessingCostLines(netWeightGrams, totalUnits, language)
    const processingCostTotal = sumMoney(processingCosts.map(line => line.lineTotal))

    const palletMaterials: PalletMaterialLine[] = resolved.pallet.map(option =>
        buildPalletMaterialLine(
            option.packagingId,
            option.packaging,
            option.optionGroup,
            palletQuantityPerPallet(option, boxesPerPallet),
            requestedPallets
        )
    )
    const palletMaterialCost = sumMoney(palletMaterials.map(line => line.lineTotal))

    const { transportCost, transport } = buildTransportLine(destination, language)
    // Sin producto no hay Product.additionalCostPerUnit: el ajuste manual es siempre $0.
    const { adjustmentCost, adjustment } = buildAdjustmentLine(0, totalUnits)

    const { percentageCosts, percentageCostTotal, totalCost } = await assembleQuoteTotals(
        {
            rawMaterialCost,
            ingredientCost,
            unitPackagingCost,
            intermediatePackagingCost,
            processingCostTotal,
            palletMaterialCost,
            transportCost,
            adjustmentCost
        },
        language
    )

    return {
        subCategoryId: input.subCategoryId,
        presentationId: input.presentationId,
        destinationId: destination?.id ?? null,
        isOrganic: input.isOrganic,
        productDisplayName: buildDisplayName(rawMaterials, input.rawMaterialMix, language),
        variantLabel: buildVariantLabel(presentation, boxesPerPallet, bagsPerBox, language),
        requestedPallets,
        totalUnits,
        boxesPerPallet,
        bagsPerBox,
        unitsPerIntermediatePackage,
        rawMaterialCost,
        ingredientCost,
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
            ingredients,
            unitMaterials,
            intermediateMaterials,
            processingCosts,
            palletMaterials,
            percentageCosts,
            transport,
            adjustment,
            language
        },
        configuration: {
            subCategoryId: input.subCategoryId,
            presentationId: input.presentationId,
            isOrganic: input.isOrganic,
            requestedPallets,
            destinationId: destination?.id ?? null,
            rawMaterialMix: input.rawMaterialMix.map(line => ({ rawMaterialId: line.rawMaterialId, percentage: line.percentage })),
            ingredients: input.ingredients.map(line => ({ ingredientId: line.ingredientId, gramsPerUnit: line.gramsPerUnit })),
            pallet: { boxesPerPallet, bagsPerBox, unitsPerIntermediatePackage },
            packaging: {
                unit: resolved.unit.map(toPackagingConfiguration),
                intermediate: resolved.intermediate.map(toPackagingConfiguration),
                pallet: resolved.pallet.map(toPackagingConfiguration),
            },
        },
    }
}

// Guardar = recalcular en el servidor y persistir ESE resultado (nunca un desglose del cliente), igual
// que quoteService.saveQuote. Escribe únicamente en customQuotes: ni Quote, ni QuoteDraft, ni el
// dashboard se enteran. El representante sale del JWT; no hay Cliente.
async function saveCustomQuote(
    salespersonId: number,
    input: CustomQuoteCalculationInput,
    language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE
): Promise<CustomQuoteCalculation & { id: number; status: CustomQuoteStatus; createdAt: Date }> {
    const calculation = await calculateCustomQuote(input, language)

    const customQuote = await CustomQuote.create({
        salespersonId,
        subCategoryId: calculation.subCategoryId,
        presentationId: calculation.presentationId,
        destinationId: calculation.destinationId,
        productDisplayName: calculation.productDisplayName,
        variantLabel: calculation.variantLabel,
        isOrganic: calculation.isOrganic,
        requestedPallets: calculation.requestedPallets,
        totalUnits: calculation.totalUnits,
        boxesPerPallet: calculation.boxesPerPallet,
        bagsPerBox: calculation.bagsPerBox,
        unitsPerIntermediatePackage: calculation.unitsPerIntermediatePackage,
        rawMaterialCost: calculation.rawMaterialCost,
        ingredientCost: calculation.ingredientCost,
        unitPackagingCost: calculation.unitPackagingCost,
        intermediatePackagingCost: calculation.intermediatePackagingCost,
        processingCostTotal: calculation.processingCostTotal,
        palletMaterialCost: calculation.palletMaterialCost,
        percentageCostTotal: calculation.percentageCostTotal,
        transportCost: calculation.transportCost,
        adjustmentCost: calculation.adjustmentCost,
        totalCost: calculation.totalCost,
        configuration: calculation.configuration,
        breakdown: calculation.breakdown,
        status: "new",
    })

    return {
        ...calculation,
        id: customQuote.id,
        status: customQuote.status,
        createdAt: customQuote.get("createdAt") as Date,
    }
}

export const customQuoteService = {
    calculateCustomQuote,
    saveCustomQuote,
}
