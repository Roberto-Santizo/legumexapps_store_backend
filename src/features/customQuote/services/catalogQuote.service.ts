import { Transaction } from "sequelize"
import jwt from "jsonwebtoken"
import { AppError } from "../../../shared/errors/AppError"
import { ContentLanguage, pickTranslatedName } from "../../../shared/utils/translation.util"
import { sumMoney, toDecimal } from "../../../shared/utils/money.util"
import { buildCustomizableRawMaterials, buildUnitMaterialLine, buildIntermediateMaterialLine, buildPalletMaterialLine, buildPerWeightProcessingCostLines, assembleQuoteTotals } from "../../quote/services/quoteCostLines"
import { resolveMaterialsForQuote, type GroupedMaterialRow } from "../../quote/services/quoteMaterialSelection"
import type Packaging from "../../packaging/models/Packaging.model"
import CustomQuote from "../models/CustomQuote.model"
import type { CatalogQuoteInput } from "../schemas/catalogQuote.schema"
import { availableRawMaterials, loadCatalogContext } from "./catalogQuoteDiscovery.service"
import { configurationIdentity, decimalString, digest, validConfiguration } from "./catalogQuoteIdentity"
import { materialGroupIdentity } from "../../../shared/utils/materialGroupIdentity.util"

const failure = (key: string, status = 422): never => { throw new AppError(status, `errors.catalog_quote_${key}`) }
const secret = () => { const value = process.env.JWT_SECRET; if (!value) return failure("unavailable", 503); return value }

function canonicalInput(input: CatalogQuoteInput): CatalogQuoteInput {
    return { categoryId: input.categoryId, subCategoryId: input.subCategoryId, configurationId: input.configurationId,
        ingredientType: input.ingredientType, isOrganic: input.isOrganic, requestedPallets: input.requestedPallets,
        rawMaterialMix: [...input.rawMaterialMix].sort((a, b) => a.rawMaterialId - b.rawMaterialId).map(row => ({ rawMaterialId: row.rawMaterialId, percentage: row.percentage })),
        selectedUnitMaterialIds: [...input.selectedUnitMaterialIds].sort((a,b) => a-b),
        selectedIntermediateMaterialIds: [...input.selectedIntermediateMaterialIds].sort((a,b) => a-b),
        selectedPalletMaterialIds: [...input.selectedPalletMaterialIds].sort((a,b) => a-b) }
}

export async function calculateCatalogQuote(input: CatalogQuoteInput, language: ContentLanguage, transaction?: Transaction) {
    input = canonicalInput(input)
    const context = await loadCatalogContext(transaction)
    const subCategory = context.subCategories.find(row => row.id === input.subCategoryId && row.categoryId === input.categoryId)
    if (!subCategory) return failure("context_invalid")
    const variant = context.variants.find(row => row.id === input.configurationId && row.parentProduct.subCategoryId === subCategory.id)
    if (!variant || !validConfiguration(variant)) return failure("configuration_invalid")
    const pool = availableRawMaterials(context.products, subCategory.id)
    const selected = input.rawMaterialMix.map(line => {
        const raw = pool.find(row => row.id === line.rawMaterialId)
        if (!raw || raw.ingredientType !== input.ingredientType || raw.isOrganic !== input.isOrganic || !raw.isMixable) return failure("composition_invalid")
        return raw
    })
    if (new Set(input.rawMaterialMix.map(line => line.rawMaterialId)).size !== input.rawMaterialMix.length) return failure("composition_invalid")
    if (!input.rawMaterialMix.length || !input.rawMaterialMix.reduce((sum, line) => sum.plus(line.percentage), toDecimal(0)).equals(100)) return failure("total_100")
    const totalUnits = input.requestedPallets * variant.boxesPerPallet * variant.bagsPerBox
    if (!Number.isSafeInteger(totalUnits) || totalUnits <= 0) return failure("quantity_invalid")
    const weight = Number(variant.sizePresentation.netWeightGrams)
    const rawMaterials = buildCustomizableRawMaterials(selected.map(raw => ({ rawMaterialId: raw.id, usedRawMaterial: raw })), input.rawMaterialMix, weight, totalUnits, language)
    const unit = resolveMaterialsForQuote(variant.unitMaterials ?? [], input.selectedUnitMaterialIds, "unit")
    const intermediate = resolveMaterialsForQuote(variant.intermediateMaterials ?? [], input.selectedIntermediateMaterialIds, "intermediate")
    const pallet = resolveMaterialsForQuote(variant.palletMaterials ?? [], input.selectedPalletMaterialIds, "pallet")
    const unitMaterials = unit.map(row => buildUnitMaterialLine(row.packagingId, row.usedUnitMaterial, row.optionGroup, row.quantityPerUnit, totalUnits))
    const intermediateMaterials = intermediate.map(row => buildIntermediateMaterialLine(row.packagingId, row.usedIntermediateMaterial, row.optionGroup, variant.unitsPerIntermediatePackage, totalUnits))
    const palletMaterials = pallet.map(row => buildPalletMaterialLine(row.packagingId, row.usedPalletMaterial, row.optionGroup, toDecimal(row.quantityValue).times(row.quantityBasis === "per_box" ? variant.boxesPerPallet : 1).toString(), input.requestedPallets))
    const processingCosts = await buildPerWeightProcessingCostLines(weight, totalUnits, language, transaction)
    const subtotals = { rawMaterialCost: sumMoney(rawMaterials.map(row => row.lineTotal)), ingredientCost: 0,
        unitPackagingCost: sumMoney(unitMaterials.map(row => row.lineTotal)), intermediatePackagingCost: sumMoney(intermediateMaterials.map(row => row.lineTotal)),
        processingCostTotal: sumMoney(processingCosts.map(row => row.lineTotal)), palletMaterialCost: sumMoney(palletMaterials.map(row => row.lineTotal)), transportCost: 0, adjustmentCost: 0 }
    const totals = await assembleQuoteTotals(subtotals, language, transaction)
    const { percentageCosts, percentageCostTotal, totalCost } = totals
    const productDisplayName = `${language === "en" ? "CUSTOM" : "MEZCLA PERSONALIZADA"} ${input.ingredientType === "fruit" ? (language === "en" ? "FRUIT BLEND" : "DE FRUTAS") : input.ingredientType === "vegetable" ? (language === "en" ? "VEGETABLE BLEND" : "DE VEGETALES") : input.ingredientType === "pulp" ? (language === "en" ? "PULP BLEND" : "DE PULPAS") : (language === "en" ? "BLEND" : "DE MATERIAS PRIMAS")}`
    const variantLabel = `${variant.bagsPerBox} × ${variant.sizePresentation.displayLabel}`
    const fingerprint = digest(configurationIdentity(variant, subCategory.id))
    const rawSnapshot = rawMaterials.map((line, index) => ({ ...line, percentage: input.rawMaterialMix[index].percentage,
        gramsPerUnit: toDecimal(weight).times(input.rawMaterialMix[index].percentage).dividedBy(100).toString(),
        totalQuantity: toDecimal(weight).times(input.rawMaterialMix[index].percentage).dividedBy(100).dividedBy(selected[index].costUnit.baseFactor).times(totalUnits).toString(),
        costUnit: { id: selected[index].costUnitId, displayName: selected[index].costUnit.displayName, unitType: selected[index].costUnit.unitType, baseFactor: decimalString(selected[index].costUnit.baseFactor) } }))
    const packagingSnapshot = (rows: (GroupedMaterialRow & { packagingId: number })[], level: "unit" | "intermediate" | "pallet", ids: number[], packagingOf: (index: number) => Packaging) => rows.map((row, index) => {
        const line = level === "unit" ? unitMaterials[index] : level === "intermediate" ? intermediateMaterials[index] : palletMaterials[index]
        const quantity = level === "unit" ? unit[index].quantityPerUnit : level === "pallet" ? pallet[index].quantityValue : 1
        const basis = level === "unit" ? "per_unit" : level === "pallet" ? pallet[index].quantityBasis : "per_intermediate"
        const effectiveQuantity = level === "intermediate" ? intermediateMaterials[index].packagesNeeded : level === "unit" ? toDecimal(quantity).times(totalUnits).toNumber() : toDecimal(palletMaterials[index].quantityPerPallet).times(input.requestedPallets).toNumber()
        return { sourceAssociationId: row.id, packagingId: row.packagingId, displayName: packagingOf(index).displayName, level,
            optionGroupId: row.optionGroupId ?? null, optionGroup: row.optionGroup, selectionOrigin: materialGroupIdentity(row) === null ? "fixed" : ids.includes(row.id!) ? "customer" : "default",
            quantityBasis: basis, quantityValue: Number(quantity), effectiveQuantity, unitCost: line.unitCost, lineTotal: line.lineTotal }
    })
    const snapshot = { schemaVersion: 2 as const, kind: "customizable" as const, language, productDisplayName,
        category: { id: subCategory.parentCategory.id, displayName: pickTranslatedName(subCategory.parentCategory.displayName, subCategory.parentCategory.translations, language) },
        subCategory: { id: subCategory.id, displayName: pickTranslatedName(subCategory.displayName, subCategory.translations, language) },
        isOrganic: input.isOrganic, ingredientType: input.ingredientType,
        source: { productVariantId: variant.id, skuCode: variant.skuCode, configurationFingerprint: fingerprint },
        presentation: { id: variant.presentationId, displayLabel: variant.sizePresentation.displayLabel, netWeightGrams: weight },
        logistics: { unitsPerBox: variant.bagsPerBox, boxesPerPallet: variant.boxesPerPallet, unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage ?? null },
        rawMaterials: rawSnapshot, ingredients: [], packaging: [
            ...packagingSnapshot(unit, "unit", input.selectedUnitMaterialIds, index => unit[index].usedUnitMaterial),
            ...packagingSnapshot(intermediate, "intermediate", input.selectedIntermediateMaterialIds, index => intermediate[index].usedIntermediateMaterial),
            ...packagingSnapshot(pallet, "pallet", input.selectedPalletMaterialIds, index => pallet[index].usedPalletMaterial),
        ], quantity: { requestedPallets: input.requestedPallets, totalUnits, totalBoxes: input.requestedPallets * variant.boxesPerPallet, totalWeightGrams: toDecimal(weight).times(totalUnits).toString() },
        costs: { currency: "USD", calculationPolicyVersion: "shared-v1", ...subtotals, percentageCostTotal, processingCosts, percentageCosts, totalCost } }
    // Capture all offered packaging dependencies, not only the selected alternative.
    const version = digest({ snapshot, configuration: configurationIdentity(variant, subCategory.id), rawDependencies: selected.map(raw => ({ id: raw.id, cost: decimalString(raw.costPerUnit), organic: raw.isOrganic, type: raw.ingredientType, factor: decimalString(raw.costUnit.baseFactor) })) })
    const configuration = { subCategoryId: subCategory.id, presentationId: variant.presentationId, isOrganic: input.isOrganic, requestedPallets: input.requestedPallets, destinationId: null,
        rawMaterialMix: input.rawMaterialMix, ingredients: [], pallet: { boxesPerPallet: variant.boxesPerPallet, bagsPerBox: variant.bagsPerBox, unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage ?? null },
        packaging: {
            unit: snapshot.packaging.filter(row => row.level === "unit").map(row => ({ packagingOptionId: row.sourceAssociationId!, packagingId: row.packagingId, optionGroup: row.optionGroup, quantity: row.quantityValue, quantityBasis: row.quantityBasis })),
            intermediate: snapshot.packaging.filter(row => row.level === "intermediate").map(row => ({ packagingOptionId: row.sourceAssociationId!, packagingId: row.packagingId, optionGroup: row.optionGroup, quantity: row.quantityValue, quantityBasis: row.quantityBasis })),
            pallet: snapshot.packaging.filter(row => row.level === "pallet").map(row => ({ packagingOptionId: row.sourceAssociationId!, packagingId: row.packagingId, optionGroup: row.optionGroup, quantity: row.quantityValue, quantityBasis: row.quantityBasis })),
        }, snapshot: { ...snapshot, calculationVersion: version } }
    return { configurationOrigin: "catalog_variant" as const, snapshotVersion: 2, sourceProductVariantId: variant.id, subCategoryId: subCategory.id, presentationId: variant.presentationId, isOrganic: input.isOrganic,
        bagsPerBox: variant.bagsPerBox, unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage ?? null,
        destinationId: null, productDisplayName, variantLabel, requestedPallets: input.requestedPallets, totalUnits, boxesPerPallet: variant.boxesPerPallet,
        ...subtotals, percentageCostTotal, totalCost, configuration,
        breakdown: { rawMaterials, ingredients: [], unitMaterials, intermediateMaterials, palletMaterials, processingCosts, percentageCosts,
            transport: { destinationId: null, displayName: language === "en" ? "No destination" : "Sin destino", baseCost: 0 }, adjustment: null, language } }
}

type Calculation = Awaited<ReturnType<typeof calculateCatalogQuote>>
function publicResult(calculation: Calculation & { confirmationKey?: string; confirmationRequestHash?: string; salespersonId?: number }) {
    const { sourceProductVariantId: _source, confirmationKey: _key, confirmationRequestHash: _hash, salespersonId: _owner, ...result } = calculation
    const { source: _audit, ...snapshot } = result.configuration.snapshot
    return { ...result, configuration: { ...result.configuration, snapshot } }
}
function inputDigest(input: CatalogQuoteInput) {
    return digest(canonicalInput(input))
}
async function consistent<T>(work: (transaction: Transaction) => Promise<T>) {
    if (!CustomQuote.sequelize) return failure("unavailable", 503)
    for (let attempt = 0; ; attempt++) {
        try { return await CustomQuote.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, work) }
        catch (error) {
            const code = (error as { original?: { code?: string; constraint?: string } }).original
            if (attempt >= 2 || !(code?.code === "40001" || (code?.code === "23505" && code.constraint === "customQuotes_confirmation_unique"))) throw error
        }
    }
}
// Internal calculator: consistent current prices, without a customer identity, token or saved row.
export async function previewAdminCatalogQuote(input: CatalogQuoteInput, language: ContentLanguage) {
    return consistent(async transaction => publicResult(await calculateCatalogQuote(input, language, transaction)))
}

export async function previewCatalogQuote(salespersonId: number, input: CatalogQuoteInput, language: ContentLanguage) {
    return consistent(async transaction => {
        const calculation = await calculateCatalogQuote(input, language, transaction)
        const previewToken = jwt.sign({ purpose: "catalog-quote-preview", salespersonId, inputHash: inputDigest(input), version: calculation.configuration.snapshot.calculationVersion, language }, secret(), { algorithm: "HS256", expiresIn: "30m", audience: "catalog-quote-confirm" })
        return { ...publicResult(calculation), previewToken }
    })
}

export async function confirmCatalogQuote(salespersonId: number, request: { input: CatalogQuoteInput; previewToken: string; confirmationKey: string }, language: ContentLanguage) {
    let claims: jwt.JwtPayload
    try {
        const value = jwt.verify(request.previewToken, secret(), { algorithms: ["HS256"], audience: "catalog-quote-confirm" })
        if (typeof value === "string") return failure("preview_invalid", 409)
        claims = value
    } catch { return failure("preview_invalid", 409) }
    if (claims.purpose !== "catalog-quote-preview" || claims.salespersonId !== salespersonId || claims.inputHash !== inputDigest(request.input) || claims.language !== language) return failure("preview_invalid", 409)
    return consistent(async transaction => {
        // Serialize concurrent retries for the same representative/key; no persistent preview rows.
        await CustomQuote.sequelize!.query("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))", { replacements: { key: `${salespersonId}:${request.confirmationKey}` }, transaction })
        const existing = await CustomQuote.findOne({ where: { salespersonId, confirmationKey: request.confirmationKey }, transaction })
        if (existing) {
            const saved = existing.toJSON() as Calculation & { id: number; status: string; createdAt: Date; confirmationRequestHash?: string }
            if (saved.confirmationRequestHash !== claims.inputHash) return failure("preview_invalid", 409)
            return { ...publicResult(saved), id: saved.id, status: saved.status, createdAt: saved.createdAt }
        }
        let calculation: Calculation
        try { calculation = await calculateCatalogQuote(request.input, language, transaction) }
        catch (error) { if (error instanceof AppError && (error.statusCode === 422 || error.statusCode === 404)) return failure("changed", 409); throw error }
        if (calculation.configuration.snapshot.calculationVersion !== claims.version) return failure("changed", 409)
        const row = await CustomQuote.create({ ...calculation, configuration: { ...calculation.configuration, snapshot: { ...calculation.configuration.snapshot, capturedAt: new Date().toISOString() } },
            salespersonId, status: "new", confirmationKey: request.confirmationKey, confirmationRequestHash: claims.inputHash }, { transaction })
        return { ...publicResult({ ...calculation, configuration: row.configuration as Calculation["configuration"] }), id: row.id, status: row.status, createdAt: row.get("createdAt") }
    })
}
