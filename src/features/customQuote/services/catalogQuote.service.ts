import { loadGenericProfiles } from "../../genericPackaging/services/genericPackaging.service"
import { resolveGenericPackaging } from "../../genericPackaging/services/genericPackagingResolver"
import { loadPalletKit, palletKitLabel, resolvePalletKit } from "../../palletKit/services/palletKit.service"
import { packagingNames } from "../../../shared/utils/packagingName.util"
import { Transaction } from "sequelize"
import jwt from "jsonwebtoken"
import { AppError } from "../../../shared/errors/AppError"
import { ContentLanguage, pickTranslatedName } from "../../../shared/utils/translation.util"
import { sumMoney, toDecimal } from "../../../shared/utils/money.util"
import { buildCustomizableRawMaterials, buildUnitMaterialLine, buildIntermediateMaterialLine, buildPalletMaterialLine, buildPerWeightProcessingCostLines, assembleQuoteTotals } from "../../pricing/services/quoteCostLines"
import { type GroupedMaterialRow } from "../../pricing/services/quoteMaterialSelection"
import { representativeBreakdown } from "../../pricing/services/representativeQuoteView"
import type Packaging from "../../packaging/models/Packaging.model"
import CustomQuote from "../models/CustomQuote.model"
import type { CatalogQuoteInput } from "../schemas/catalogQuote.schema"
import { eligibleRawMaterials, loadCatalogContext, subCategoryComposition } from "./catalogQuoteDiscovery.service"
import { digest } from "../../../shared/utils/digest.util"
import type { QuoteOrderIdentity } from "../../quoteOrder/schemas/quoteOrder.schema"
import { assertQuoteOrderOpen } from "../../quoteReview/services/quoteOrderLock"

const decimalString = (value: number | string | null | undefined) => toDecimal(value).toString()

const failure = (key: string, status = 422): never => { throw new AppError(status, `errors.catalog_quote_${key}`) }
const secret = () => { const value = process.env.JWT_SECRET; if (!value) return failure("unavailable", 503); return value }

function canonicalInput(input: CatalogQuoteInput): CatalogQuoteInput {
    return { configurationOrigin: "generic_configuration", palletKitSelections: [...(input.palletKitSelections ?? [])].map(row => ({ type: row.type, packagingId: row.packagingId })).sort((a, b) => a.type.localeCompare(b.type)), packagingSelections: [...(input.packagingSelections ?? [])].map(g => ({ groupId: g.groupId, optionIds: [...g.optionIds].sort((a,b)=>a-b) })).sort((a,b)=>a.groupId-b.groupId), categoryId: input.categoryId, subCategoryId: input.subCategoryId, configurationId: input.configurationId,
        ingredientType: input.ingredientType, requestedPallets: input.requestedPallets,
        rawMaterialMix: [...input.rawMaterialMix].sort((a, b) => a.rawMaterialId - b.rawMaterialId).map(row => ({ rawMaterialId: row.rawMaterialId, percentage: row.percentage })) }
}

export async function calculateCatalogQuote(input: CatalogQuoteInput, language: ContentLanguage, transaction?: Transaction) {
    input = canonicalInput(input)
    const context = await loadCatalogContext(transaction)
    const subCategory = context.subCategories.find(row => row.id === input.subCategoryId && row.categoryId === input.categoryId)
    if (!subCategory) return failure("context_invalid")
    const profile = (await loadGenericProfiles(transaction)).find(row => row.id === input.configurationId && row.categoryId === input.categoryId)
    if (!profile) return failure("configuration_invalid")
    const resolved = resolveGenericPackaging(profile, input.packagingSelections ?? [])
    // Every pallet of a new product carries the standard kit (tarima, esquineros, stretch) from the catalog.
    const kit = await loadPalletKit(transaction)
    if (resolved.some(row => kit.some(part => part.options.some(option => option.id === row.option.packagingId)))) return failure("configuration_invalid")
    const palletKit = resolvePalletKit(kit, input.palletKitSelections)
    const rows = resolved.map(({ group, option, origin }) => ({ id: option.id, packagingId: option.packagingId, optionGroupId: group.packagingGroupId, optionGroup: group.group.displayName, isDefault: false,
        quantityPerUnit: Number(option.quantityValue), quantityValue: Number(option.quantityValue), quantityBasis: option.quantityBasis, level: group.level, origin,
        usedUnitMaterial: option.packaging as Packaging, usedIntermediateMaterial: option.packaging as Packaging, usedPalletMaterial: option.packaging as Packaging }))
    const variant = { id: profile.id, presentationId: profile.presentationId, sizePresentation: profile.presentation,
        bagsPerBox: profile.bagsPerBox, boxesPerPallet: profile.boxesPerPallet, unitsPerIntermediatePackage: profile.unitsPerIntermediatePackage,
        unitMaterials: rows.filter(row=>row.level === "unit"), intermediateMaterials: rows.filter(row=>row.level === "intermediate"), palletMaterials: rows.filter(row=>row.level === "pallet") }
    const composition = subCategoryComposition(context.products, subCategory.id)
    if (!composition) return failure("context_invalid")
    const pool = eligibleRawMaterials(context.rawMaterials, composition.types)
    const selected = input.rawMaterialMix.map(line => {
        const raw = pool.find(row => row.id === line.rawMaterialId)
        if (!raw || raw.ingredientType !== input.ingredientType) return failure("composition_invalid")
        return raw
    })
    if (new Set(input.rawMaterialMix.map(line => line.rawMaterialId)).size !== input.rawMaterialMix.length) return failure("composition_invalid")
    if (!input.rawMaterialMix.length || !input.rawMaterialMix.reduce((sum, line) => sum.plus(line.percentage), toDecimal(0)).equals(100)) return failure("total_100")
    // Single: exactly one raw material at 100%. Blend: two or more of the same type.
    if (composition.mode === "single" ? input.rawMaterialMix.length !== 1 : input.rawMaterialMix.length < 2) return failure("composition_invalid")
    const totalUnits = input.requestedPallets * variant.boxesPerPallet * variant.bagsPerBox
    if (!Number.isSafeInteger(totalUnits) || totalUnits <= 0) return failure("quantity_invalid")
    const weight = Number(variant.sizePresentation.netWeightGrams)
    const rawMaterials = buildCustomizableRawMaterials(selected.map(raw => ({ rawMaterialId: raw.id, usedRawMaterial: raw })), input.rawMaterialMix, weight, totalUnits, language)
    const unit = variant.unitMaterials
    const intermediate = variant.intermediateMaterials
    const pallet = variant.palletMaterials
    const unitMaterials = unit.map(row => buildUnitMaterialLine(row.packagingId, row.usedUnitMaterial, row.optionGroup, row.quantityPerUnit, totalUnits))
    const intermediateMaterials = intermediate.map(row => buildIntermediateMaterialLine(row.packagingId, row.usedIntermediateMaterial, row.optionGroup, variant.unitsPerIntermediatePackage, totalUnits))
    const configuredPalletMaterials = pallet.map(row => buildPalletMaterialLine(row.packagingId, row.usedPalletMaterial, row.optionGroup, toDecimal(row.quantityValue).times(row.quantityBasis === "per_box" ? variant.boxesPerPallet : 1).toString(), input.requestedPallets))
    const kitLabel = palletKitLabel(language)
    const kitLines = palletKit.map(({ material }) => buildPalletMaterialLine(material.id!, material, kitLabel, toDecimal(material.defaultQuantityValue).toString(), input.requestedPallets))
    const palletMaterials = [...configuredPalletMaterials, ...kitLines]
    const processingCosts = await buildPerWeightProcessingCostLines(weight, totalUnits, language, transaction)
    const subtotals = { rawMaterialCost: sumMoney(rawMaterials.map(row => row.lineTotal)), ingredientCost: 0,
        unitPackagingCost: sumMoney(unitMaterials.map(row => row.lineTotal)), intermediatePackagingCost: sumMoney(intermediateMaterials.map(row => row.lineTotal)),
        processingCostTotal: sumMoney(processingCosts.map(row => row.lineTotal)), palletMaterialCost: sumMoney(palletMaterials.map(row => row.lineTotal)), transportCost: 0, adjustmentCost: 0 }
    const totals = await assembleQuoteTotals(subtotals, language, transaction)
    const { percentageCosts, percentageCostTotal, totalCost } = totals
    const blendName = `${language === "en" ? "CUSTOM" : "MEZCLA PERSONALIZADA"} ${input.ingredientType === "fruit" ? (language === "en" ? "FRUIT BLEND" : "DE FRUTAS") : input.ingredientType === "vegetable" ? (language === "en" ? "VEGETABLE BLEND" : "DE VEGETALES") : input.ingredientType === "pulp" ? (language === "en" ? "PULP BLEND" : "DE PULPAS") : (language === "en" ? "BLEND" : "DE MATERIAS PRIMAS")}`
    const productDisplayName = composition.mode === "single" ? pickTranslatedName(selected[0].displayName, selected[0].translations, language) : blendName
    const variantLabel = `${variant.bagsPerBox} × ${variant.sizePresentation.displayLabel}`
    const fingerprint = digest(profile)
    const rawSnapshot = rawMaterials.map((line, index) => ({ ...line, percentage: input.rawMaterialMix[index].percentage,
        gramsPerUnit: toDecimal(weight).times(input.rawMaterialMix[index].percentage).dividedBy(100).toString(),
        totalQuantity: toDecimal(weight).times(input.rawMaterialMix[index].percentage).dividedBy(100).dividedBy(selected[index].costUnit.baseFactor).times(totalUnits).toString(),
        costUnit: { id: selected[index].costUnitId, displayName: selected[index].costUnit.displayName, unitType: selected[index].costUnit.unitType, baseFactor: decimalString(selected[index].costUnit.baseFactor) } }))
    const packagingSnapshot = (rows: (GroupedMaterialRow & { packagingId: number })[], level: "unit" | "intermediate" | "pallet", packagingOf: (index: number) => Packaging) => rows.map((row, index) => {
        const line = level === "unit" ? unitMaterials[index] : level === "intermediate" ? intermediateMaterials[index] : palletMaterials[index]
        const quantity = level === "unit" ? unit[index].quantityPerUnit : level === "pallet" ? pallet[index].quantityValue : 1
        const basis = level === "unit" ? "per_unit" : level === "pallet" ? pallet[index].quantityBasis : "per_intermediate"
        const effectiveQuantity = level === "intermediate" ? intermediateMaterials[index].packagesNeeded : level === "unit" ? toDecimal(quantity).times(totalUnits).toNumber() : toDecimal(palletMaterials[index].quantityPerPallet).times(input.requestedPallets).toNumber()
        return { sourceAssociationId: row.id, packagingId: row.packagingId, ...packagingNames(packagingOf(index)), level,
            optionGroupId: row.optionGroupId ?? null, optionGroup: row.optionGroup, selectionOrigin: resolved.find(r=>r.option.id === row.id)?.origin === "included" ? "included" : "customer",
            quantityBasis: basis, quantityValue: Number(quantity), effectiveQuantity, unitCost: line.unitCost, lineTotal: line.lineTotal }
    })
    const snapshot = { schemaVersion: 3 as const, kind: "customizable" as const, language, productDisplayName,
        category: { id: subCategory.parentCategory.id, displayName: pickTranslatedName(subCategory.parentCategory.displayName, subCategory.parentCategory.translations, language) },
        subCategory: { id: subCategory.id, displayName: pickTranslatedName(subCategory.displayName, subCategory.translations, language) },
        ingredientType: input.ingredientType, compositionMode: composition.mode,
        source: { genericConfigurationId: profile.id, configurationFingerprint: fingerprint },
        presentation: { id: variant.presentationId, displayLabel: variant.sizePresentation.displayLabel, netWeightGrams: weight },
        logistics: { unitsPerBox: variant.bagsPerBox, boxesPerPallet: variant.boxesPerPallet, unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage ?? null },
        rawMaterials: rawSnapshot, ingredients: [], packaging: [
            ...packagingSnapshot(unit, "unit", index => unit[index].usedUnitMaterial),
            ...packagingSnapshot(intermediate, "intermediate", index => intermediate[index].usedIntermediateMaterial),
            ...packagingSnapshot(pallet, "pallet", index => pallet[index].usedPalletMaterial),
            ...palletKit.map(({ material, chosen }, index) => ({ sourceAssociationId: null, packagingId: material.id!, ...packagingNames(material), level: "pallet" as const, optionGroupId: null, optionGroup: kitLabel, selectionOrigin: chosen ? "customer" : "included",
                quantityBasis: "per_pallet", quantityValue: Number(material.defaultQuantityValue), effectiveQuantity: toDecimal(kitLines[index].quantityPerPallet).times(input.requestedPallets).toNumber(), unitCost: kitLines[index].unitCost, lineTotal: kitLines[index].lineTotal })),
        ], quantity: { requestedPallets: input.requestedPallets, totalUnits, totalBoxes: input.requestedPallets * variant.boxesPerPallet, totalWeightGrams: toDecimal(weight).times(totalUnits).toString() },
        costs: { currency: "USD", calculationPolicyVersion: "shared-v1", ...subtotals, percentageCostTotal, processingCosts, percentageCosts, totalCost } }
    // Capture all offered packaging dependencies, not only the selected alternative.
    const version = digest({ snapshot, configuration: profile, palletKit: kit.map(part => ({ type: part.type, options: part.options.map(material => ({ id: material.id, cost: decimalString(material.unitCost), basis: material.defaultQuantityBasis, quantity: decimalString(material.defaultQuantityValue) })) })), rawDependencies: selected.map(raw => ({ id: raw.id, cost: decimalString(raw.costPerUnit), type: raw.ingredientType, factor: decimalString(raw.costUnit.baseFactor) })) })
    const configuration = { subCategoryId: subCategory.id, presentationId: variant.presentationId, requestedPallets: input.requestedPallets, destinationId: null,
        rawMaterialMix: input.rawMaterialMix, ingredients: [], pallet: { boxesPerPallet: variant.boxesPerPallet, bagsPerBox: variant.bagsPerBox, unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage ?? null },
        packaging: {
            unit: snapshot.packaging.filter(row => row.level === "unit").map(row => ({ packagingOptionId: row.sourceAssociationId!, packagingId: row.packagingId, optionGroup: row.optionGroup, quantity: row.quantityValue, quantityBasis: row.quantityBasis })),
            intermediate: snapshot.packaging.filter(row => row.level === "intermediate").map(row => ({ packagingOptionId: row.sourceAssociationId!, packagingId: row.packagingId, optionGroup: row.optionGroup, quantity: row.quantityValue, quantityBasis: row.quantityBasis })),
            pallet: snapshot.packaging.filter(row => row.level === "pallet").map(row => ({ packagingOptionId: row.sourceAssociationId!, packagingId: row.packagingId, optionGroup: row.optionGroup, quantity: row.quantityValue, quantityBasis: row.quantityBasis })),
        }, snapshot: { ...snapshot, calculationVersion: version } }
    return { configurationOrigin: "generic_configuration" as const, snapshotVersion: 3, sourceProductVariantId: null, sourceGenericConfigurationId: profile.id, subCategoryId: subCategory.id, presentationId: variant.presentationId,
        bagsPerBox: variant.bagsPerBox, unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage ?? null,
        destinationId: null, productDisplayName, variantLabel, requestedPallets: input.requestedPallets, totalUnits, boxesPerPallet: variant.boxesPerPallet,
        ...subtotals, percentageCostTotal, totalCost, configuration,
        breakdown: { production: { kind: "customizable" as const, boxesPerPallet: variant.boxesPerPallet, bagsPerBox: variant.bagsPerBox, netWeightGrams: weight }, order: undefined as QuoteOrderIdentity | undefined, rawMaterials, ingredients: [], unitMaterials, intermediateMaterials, palletMaterials, processingCosts, percentageCosts,
            transport: { destinationId: null, displayName: language === "en" ? "No destination" : "Sin destino", baseCost: 0 }, adjustment: null, language } }
}

type Calculation = Awaited<ReturnType<typeof calculateCatalogQuote>>
function publicResult(calculation: Calculation & { confirmationKey?: string; confirmationRequestHash?: string; salespersonId?: number }) {
    const { sourceGenericConfigurationId: _genericSource, sourceProductVariantId: _source, confirmationKey: _key, confirmationRequestHash: _hash, salespersonId: _owner, ...result } = calculation
    const { source: _audit, ...snapshot } = result.configuration.snapshot
    return { ...result, configuration: { ...result.configuration, snapshot } }
}
// Lo que recibe el representante: publicResult sin ningún monto (ver
// pricing/services/representativeQuoteView.ts). configuration y su snapshot conservan lo que se
// cotiza; snapshot.costs y los costos por línea no viajan.
function representativeResult(calculation: Calculation) {
    const result = publicResult(calculation)
    const { snapshot } = result.configuration
    return {
        configurationOrigin: result.configurationOrigin, snapshotVersion: result.snapshotVersion, subCategoryId: result.subCategoryId, presentationId: result.presentationId,
        bagsPerBox: result.bagsPerBox, unitsPerIntermediatePackage: result.unitsPerIntermediatePackage, destinationId: result.destinationId,
        productDisplayName: result.productDisplayName, variantLabel: result.variantLabel, requestedPallets: result.requestedPallets, totalUnits: result.totalUnits, boxesPerPallet: result.boxesPerPallet,
        configuration: {
            subCategoryId: result.configuration.subCategoryId, presentationId: result.configuration.presentationId, requestedPallets: result.configuration.requestedPallets,
            destinationId: result.configuration.destinationId, rawMaterialMix: result.configuration.rawMaterialMix, ingredients: result.configuration.ingredients,
            pallet: result.configuration.pallet, packaging: result.configuration.packaging,
            snapshot: {
                schemaVersion: snapshot.schemaVersion, kind: snapshot.kind, language: snapshot.language, productDisplayName: snapshot.productDisplayName,
                ...((snapshot as { capturedAt?: string }).capturedAt ? { capturedAt: (snapshot as { capturedAt?: string }).capturedAt } : {}),
                category: snapshot.category, subCategory: snapshot.subCategory, ingredientType: snapshot.ingredientType, compositionMode: snapshot.compositionMode,
                presentation: snapshot.presentation, logistics: snapshot.logistics, quantity: snapshot.quantity, calculationVersion: snapshot.calculationVersion,
                rawMaterials: snapshot.rawMaterials.map(line => ({ rawMaterialId: line.rawMaterialId, displayName: line.displayName, percentage: line.percentage, gramsPerUnit: line.gramsPerUnit, totalQuantity: line.totalQuantity })),
                packaging: snapshot.packaging.map(row => ({ packagingId: row.packagingId, displayName: row.displayName, displayNameEn: row.displayNameEn, level: row.level, optionGroupId: row.optionGroupId,
                    optionGroup: row.optionGroup, selectionOrigin: row.selectionOrigin, quantityBasis: row.quantityBasis, quantityValue: row.quantityValue, effectiveQuantity: row.effectiveQuantity })),
            },
        },
        breakdown: representativeBreakdown(result.breakdown),
    }
}
function inputDigest(input: CatalogQuoteInput) {
    return digest(canonicalInput(input))
}
async function consistent<T>(work: (transaction: Transaction) => Promise<T>, isolationLevel = Transaction.ISOLATION_LEVELS.REPEATABLE_READ) {
    if (!CustomQuote.sequelize) return failure("unavailable", 503)
    for (let attempt = 0; ; attempt++) {
        try { return await CustomQuote.sequelize.transaction({ isolationLevel }, work) }
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
        return { ...representativeResult(calculation), previewToken }
    })
}

export async function confirmCatalogQuote(salespersonId: number, request: { input: CatalogQuoteInput; previewToken: string; confirmationKey: string; order?: QuoteOrderIdentity }, language: ContentLanguage) {
    let claims: jwt.JwtPayload
    try {
        const value = jwt.verify(request.previewToken, secret(), { algorithms: ["HS256"], audience: "catalog-quote-confirm" })
        if (typeof value === "string") return failure("preview_invalid", 409)
        claims = value
    } catch { return failure("preview_invalid", 409) }
    if (claims.purpose !== "catalog-quote-preview" || claims.salespersonId !== salespersonId || claims.inputHash !== inputDigest(request.input) || claims.language !== language) return failure("preview_invalid", 409)
    // READ COMMITTED, no REPEATABLE READ: el estado del pedido se lee después de tomar su bloqueo y debe
    // ver una revisión creada o aprobada mientras se esperaba (ver assertQuoteOrderOpen). El cálculo
    // sigue protegido: solo se guarda si su versión (que resume el snapshot y todas sus dependencias)
    // coincide con la del preview, calculado en REPEATABLE READ; una lectura mezclada no coincide → 409.
    return consistent(async transaction => {
        // Serialize concurrent retries for the same representative/key; no persistent preview rows.
        await CustomQuote.sequelize!.query("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))", { replacements: { key: `${salespersonId}:${request.confirmationKey}` }, transaction })
        const existing = await CustomQuote.findOne({ where: { salespersonId, confirmationKey: request.confirmationKey }, transaction })
        if (existing) {
            const saved = existing.toJSON() as Calculation & { id: number; status: string; createdAt: Date; confirmationRequestHash?: string }
            if (saved.confirmationRequestHash !== claims.inputHash) return failure("preview_invalid", 409)
            if (JSON.stringify(saved.breakdown.order) !== JSON.stringify(request.order)) return failure("preview_invalid", 409)
            return { ...representativeResult(saved), id: saved.id, status: saved.status, createdAt: saved.createdAt }
        }
        if (request.order) await assertQuoteOrderOpen(request.order.id, transaction)
        let calculation: Calculation
        try { calculation = await calculateCatalogQuote(request.input, language, transaction) }
        catch (error) { if (error instanceof AppError && (error.statusCode === 422 || error.statusCode === 404)) return failure("changed", 409); throw error }
        if (calculation.configuration.snapshot.calculationVersion !== claims.version) return failure("changed", 409)
        calculation.breakdown.order = request.order
        const row = await CustomQuote.create({ ...calculation, configuration: { ...calculation.configuration, snapshot: { ...calculation.configuration.snapshot, capturedAt: new Date().toISOString() } },
            salespersonId, status: "new", confirmationKey: request.confirmationKey, confirmationRequestHash: claims.inputHash }, { transaction })
        return { ...representativeResult({ ...calculation, configuration: row.configuration as Calculation["configuration"] }), id: row.id, status: row.status, createdAt: row.get("createdAt") }
    }, Transaction.ISOLATION_LEVELS.READ_COMMITTED)
}
