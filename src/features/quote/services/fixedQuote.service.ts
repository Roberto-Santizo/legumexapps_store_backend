import { isPalletKitType } from "../../packaging/constants/packagingMaterialType.constant"
import { quoteService, QuoteCalculation, AdminQuoteInput } from "./quote.service"
import { calculateQuoteSchema, CalculateQuoteInput, SalespersonQuoteInput } from "../schemas/quote.schema"
import Quote from "../models/Quote.model"
import Product from "../../product/models/Product.model"
import ProductVariant from "../../product/models/ProductVariant.model"
import ProductRawMaterial from "../../product/models/ProductRawMaterial.model"
import ProductIngredient from "../../product/models/ProductIngredient.model"
import UnitMaterial from "../../product/models/ProductVariantUnitMaterial.model"
import IntermediateMaterial from "../../product/models/ProductVariantIntermediateMaterial.model"
import PalletMaterial from "../../product/models/ProductVariantPalletMaterial.model"
import Presentation from "../../presentation/models/Presentation.model"
import Packaging from "../../packaging/models/Packaging.model"
import Client from "../../client/models/Client.model"
import SubCategory from "../../category/models/SubCategory.model"
import Category from "../../category/models/Category.model"
import Juice from "../../juice/models/Juice.model"
import Mix from "../../juice/models/JuiceMix.model"
import Raw from "../../juice/models/JuiceRawMaterial.model"
import { loadJuiceRecipe } from "../../juice/services/juiceRecipe.service"
import { buildJuiceCostLines } from "../../juice/services/juiceCostLines"
import { assertFixedPackaging, assertPackagingQuantity, buildIngredientLine, buildUnitMaterialLine, buildIntermediateMaterialLine, buildPalletMaterialLine } from "../../pricing/services/quoteCostLines"
import { resolveMaterialsForQuote } from "../../pricing/services/quoteMaterialSelection"
import { loadPalletKit, palletKitLines } from "../../palletKit/services/palletKit.service"
import { quoteDraftService } from "../../quoteDraft/services/quoteDraft.service"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE } from "../../../shared/utils/translation.util"
import { roundMoney, sumMoney, toDecimal } from "../../../shared/utils/money.util"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"

async function linkedJuice(variantId: number) {
    const variant = await ProductVariant.findOne({ where: { id: variantId }, attributes: ["id", "productId"] })
    return variant ? Juice.findOne({ where: { productId: variant.productId } }) : null
}

export async function calculateLinkedJuice(juice: Juice, input: CalculateQuoteInput, language: ContentLanguage): Promise<QuoteCalculation> {
    if (!juice.isActive) throw new AppError(422, "errors.juice_invalid_recipe")
    if (input.destinationId) throw new AppError(422, "errors.juice_direct_costs_only")
    const variant = await ProductVariant.findOne({ where: { id: input.productVariantId, productId: juice.productId, isActive: true }, include: [
        { model: Product, as: "parentProduct", required: true, where: { isActive: true }, include: [
            { model: SubCategory, as: "parentSubCategory", required: true, where: { isActive: true }, include: [{ model: Category, as: "parentCategory", required: true, where: { isActive: true } }] },
            { model: ProductRawMaterial, as: "productRawMaterials", required: false, where: { isActive: true } },
            { model: ProductIngredient, as: "productIngredients", required: false, where: { isActive: true } },
        ] },
        { model: Presentation, as: "sizePresentation", required: true, where: { isActive: true } },
        { model: UnitMaterial, as: "unitMaterials", required: false, where: { isActive: true }, include: [{ model: Packaging, as: "usedUnitMaterial", required: false }] },
        { model: IntermediateMaterial, as: "intermediateMaterials", required: false, where: { isActive: true }, include: [{ model: Packaging, as: "usedIntermediateMaterial", required: false }] },
        { model: PalletMaterial, as: "palletMaterials", required: false, where: { isActive: true }, include: [{ model: Packaging, as: "usedPalletMaterial", required: false }] },
    ] })
    if (!variant) throw new NotFoundError("ProductVariant", input.productVariantId)
    if (!await Client.findOne({ where: { id: variant.parentProduct.clientId, isActive: true } })) throw new NotFoundError("Client", variant.parentProduct.clientId)
    if (variant.parentProduct.productRawMaterials?.length || variant.parentProduct.productIngredients?.length) throw new AppError(422, "errors.juice_volume_recipe_required")
    const ml = toDecimal(variant.sizePresentation.netVolumeMl ?? 0)
    const weight = toDecimal(variant.sizePresentation.netWeightGrams ?? 0)
    if (!ml.isFinite() || ml.lte(0) || !weight.isFinite() || weight.lte(0)) throw new AppError(422, "errors.juice_volume_required")
    if (!Number.isSafeInteger(variant.boxesPerPallet) || Number(variant.boxesPerPallet) <= 0 || !Number.isSafeInteger(variant.bagsPerBox) || Number(variant.bagsPerBox) <= 0) throw new AppError(422, "errors.pallet_not_configured")
    const totalUnits = input.requestedPallets * Number(variant.boxesPerPallet) * Number(variant.bagsPerBox)
    if (!Number.isSafeInteger(totalUnits) || totalUnits <= 0) throw new AppError(422, "errors.juice_invalid_cost_input")
    const { recipe, ingredientRows } = await loadJuiceRecipe(juice.id, false, language)
    // The volume engine validates the full recipe and all source amounts. No product math changes.
    buildJuiceCostLines(recipe, { mlPerBottle: ml.toString(), bottlesPerCase: Number(variant.bagsPerBox), casesPerPallet: Number(variant.boxesPerPallet), boxUnitCost: 0, stickerUnitCost: 0, stickerQuantityPerCase: 0, secondStickerUnitCost: 0, secondStickerQuantityPerCase: 0, bottleUnitCost: 0, capUnitCost: 0 }, input.requestedPallets * Number(variant.boxesPerPallet))
    const liters = ml.div(1000)
    const rawMaterials = recipe.rawMaterials.map(row => {
        const amount = liters.times(row.percentage).div(100)
        return { rawMaterialId: row.rawMaterialId, displayName: row.displayName, percentage: Number(row.percentage), quantityUnit: "LITRO", unitCost: Number(row.costPerLiter), quantityPerUnit: amount.toNumber(), totalUnits, lineTotal: roundMoney(amount.times(row.costPerLiter).times(totalUnits)) }
    })
    const ingredients = ingredientRows.map(row => buildIngredientLine(Number(row.ingredientId), row.ingredient, liters.times(row.gramsPerLiter).toString(), weight.toString(), weight, totalUnits, toDecimal(totalUnits), language))
    const checkPackaging = (packaging: Packaging | undefined, role: string) => assertFixedPackaging(packaging, role, "errors.juice_invalid_packaging")
    if (!variant.unitMaterials?.length || (!variant.palletMaterials?.length && !variant.usesPalletKit)) throw new AppError(422, "errors.pallet_materials_not_configured")
    const unitMaterials = resolveMaterialsForQuote(variant.unitMaterials, input.selectedUnitMaterialIds, "unit").map(row => { checkPackaging(row.usedUnitMaterial, "unit"); assertPackagingQuantity(row.quantityPerUnit); return buildUnitMaterialLine(row.packagingId, row.usedUnitMaterial, row.optionGroup, row.quantityPerUnit, totalUnits) })
    const intermediateMaterials = resolveMaterialsForQuote(variant.intermediateMaterials ?? [], input.selectedIntermediateMaterialIds, "intermediate").map(row => { checkPackaging(row.usedIntermediateMaterial, "intermediate"); return buildIntermediateMaterialLine(row.packagingId, row.usedIntermediateMaterial, row.optionGroup, variant.unitsPerIntermediatePackage, totalUnits) })
    const ownPalletMaterials = resolveMaterialsForQuote(variant.palletMaterials ?? [], input.selectedPalletMaterialIds, "pallet").map(row => { checkPackaging(row.usedPalletMaterial, "pallet"); if (variant.usesPalletKit && isPalletKitType(row.usedPalletMaterial?.materialType)) throw new AppError(422, "errors.pallet_material_in_kit"); assertPackagingQuantity(row.quantityValue); if (row.quantityBasis !== "per_box" && row.quantityBasis !== "per_pallet") throw new AppError(422, "errors.pallet_consumption_invalid"); return buildPalletMaterialLine(row.packagingId, row.usedPalletMaterial, row.optionGroup, toDecimal(row.quantityValue).times(row.quantityBasis === "per_box" ? Number(variant.boxesPerPallet) : 1).toString(), input.requestedPallets) })
    // Juices are sold by the pallet too: the SKU's kit (tarima, esquineros, stretch) is added the same way.
    if (!variant.usesPalletKit && input.palletKitSelections?.length) throw new AppError(422, "errors.pallet_kit_selection")
    const kitLines = variant.usesPalletKit ? palletKitLines(await loadPalletKit(), input.palletKitSelections, input.requestedPallets, language) : []
    const palletMaterials = [...ownPalletMaterials, ...kitLines.map(row => row.line)]
    const rawMaterialCost = sumMoney(rawMaterials.map(row => row.lineTotal)), ingredientCost = sumMoney(ingredients.map(row => row.lineTotal))
    const unitPackagingCost = sumMoney(unitMaterials.map(row => row.lineTotal)), intermediatePackagingCost = sumMoney(intermediateMaterials.map(row => row.lineTotal)), palletMaterialCost = sumMoney(palletMaterials.map(row => row.lineTotal))
    return { productVariantId: variant.id, destinationId: null, productDisplayName: variant.parentProduct.displayName, variantLabel: `${variant.skuCode} · ${variant.sizePresentation.displayLabel}`, requestedPallets: input.requestedPallets, totalUnits, boxesPerPallet: Number(variant.boxesPerPallet), rawMaterialCost, ingredientCost, unitPackagingCost, intermediatePackagingCost, palletMaterialCost, processingCostTotal: 0, percentageCostTotal: 0, transportCost: 0, adjustmentCost: 0, totalCost: sumMoney([rawMaterialCost, ingredientCost, unitPackagingCost, intermediatePackagingCost, palletMaterialCost]), breakdown: {
        production: { productId: variant.productId, skuCode: variant.skuCode, boxesPerPallet: Number(variant.boxesPerPallet), bagsPerBox: Number(variant.bagsPerBox), netWeightGrams: weight.toNumber() },
        rawMaterials, ingredients, unitMaterials, intermediateMaterials, palletMaterials, processingCosts: [], percentageCosts: [], transport: { destinationId: null, displayName: "", baseCost: 0 }, adjustment: null, language,
    } }
}

async function calculateQuote(input: CalculateQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE) {
    const parsed = calculateQuoteSchema.parse(input)
    const juice = await linkedJuice(parsed.productVariantId)
    return juice ? calculateLinkedJuice(juice, parsed, language) : quoteService.calculateQuote(parsed, language)
}

async function listQuotableProducts(language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE, clientIds?: readonly number[]): ReturnType<typeof quoteService.listQuotableProducts> {
    if (clientIds && !clientIds.length) return []
    const [products, juices, variants] = await Promise.all([
        clientIds === undefined ? quoteService.listQuotableProducts(language) : quoteService.listQuotableProducts(language, clientIds),
        Juice.findAll({ include: [{ model: Mix, as: "mix", required: false, where: { isActive: true }, include: [{ model: Raw, as: "rawMaterial", required: false }] }] }),
        ProductVariant.findAll({ where: { isActive: true }, include: [{ model: Presentation, as: "sizePresentation" }] }),
    ])
    return products.flatMap(product => {
        const juice = juices.find(row => row.productId === product.id)
        if (!juice) return [product]
        if (!juice.isActive || !juice.mix?.length || !juice.mix.every(row => row.rawMaterial?.isActive) || !juice.mix.reduce((sum, row) => sum.plus(row.percentage), toDecimal(0)).eq(100)) return []
        const eligible = product.variants.filter(variant => { const shared = variants.find(row => row.id === variant.id); return Number(shared?.sizePresentation?.netVolumeMl) > 0 })
        return eligible.length ? [{ ...product, fixedRecipe: juice.mix.map(row => ({ rawMaterialId: row.rawMaterialId, displayName: row.rawMaterial.displayName, percentage: Number(row.percentage) })), variants: eligible }] : []
    })
}

async function saveQuote(salespersonId: number, input: SalespersonQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE) {
    const juice = await linkedJuice(calculateQuoteSchema.parse(input).productVariantId)
    if (!juice) return quoteService.saveQuote(salespersonId, input, language)
    const calculation = await calculateLinkedJuice(juice, input, language)
    if (input.order) calculation.breakdown.order = input.order
    const { boxesPerPallet: _boxes, ...snapshot } = calculation
    const quote = await Quote.create({ ...snapshot, salespersonId })
    if (input.draftKey) {
        try { await quoteDraftService.markConverted(input.draftKey, salespersonId, quote.id) }
        catch { console.error("Quote draft conversion failed; sensitive details suppressed") }
    }
    return { ...calculation, id: quote.id, createdAt: quote.get("createdAt") as Date }
}

async function saveAdminQuote(createdByUserId: number, input: AdminQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE) {
    const juice = await linkedJuice(calculateQuoteSchema.parse(input).productVariantId)
    if (!juice) return quoteService.saveAdminQuote(createdByUserId, input, language)
    const { order, ...calculationInput } = input
    const calculation = await calculateLinkedJuice(juice, calculationInput, language)
    calculation.breakdown.order = order
    const { boxesPerPallet: _boxes, ...snapshot } = calculation
    const quote = await Quote.create({ ...snapshot, createdByUserId })
    return { ...calculation, id: quote.id, createdAt: quote.get("createdAt") as Date }
}

export const fixedQuoteService: typeof quoteService = { ...quoteService, calculateQuote, listQuotableProducts, saveQuote, saveAdminQuote }
