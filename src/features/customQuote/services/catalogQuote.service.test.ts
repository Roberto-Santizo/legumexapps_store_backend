jest.mock("../../product/models/Product.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../../product/models/ProductVariant.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../../category/models/SubCategory.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../processingCost/models/ProcessingCost.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/CustomQuote.model", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn(), sequelize: { transaction: jest.fn(), query: jest.fn() } } }))
jest.mock("../../lead/models/Lead.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../../quote/models/Quote.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../../quoteDraft/models/QuoteDraft.model", () => ({ __esModule: true, default: { create: jest.fn(), upsert: jest.fn() } }))
jest.mock("../../salesperson/models/Salesperson.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../models/CustomQuoteRawMaterialOption.model", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn() } }))
jest.mock("../models/CustomQuoteIngredientOption.model", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn() } }))
jest.mock("../models/CustomQuotePresentationOption.model", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn() } }))
jest.mock("../models/CustomQuotePackagingOption.model", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn() } }))

import Product from "../../product/models/Product.model"
import ProductVariant from "../../product/models/ProductVariant.model"
import SubCategory from "../../category/models/SubCategory.model"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import CustomQuote from "../models/CustomQuote.model"
import Lead from "../../lead/models/Lead.model"
import Quote from "../../quote/models/Quote.model"
import QuoteDraft from "../../quoteDraft/models/QuoteDraft.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import CustomQuoteRawMaterialOption from "../models/CustomQuoteRawMaterialOption.model"
import CustomQuoteIngredientOption from "../models/CustomQuoteIngredientOption.model"
import CustomQuotePresentationOption from "../models/CustomQuotePresentationOption.model"
import CustomQuotePackagingOption from "../models/CustomQuotePackagingOption.model"
import { catalogQuoteInputSchema } from "../schemas/catalogQuote.schema"
import { discoverCatalog } from "./catalogQuoteDiscovery.service"
import { configurationIdentity, digest, validConfiguration } from "./catalogQuoteIdentity"
import { calculateCatalogQuote, previewCatalogQuote, confirmCatalogQuote, previewAdminCatalogQuote } from "./catalogQuote.service"
import type { Transaction } from "sequelize"

const mock = (fn: unknown) => fn as jest.Mock
const input = catalogQuoteInputSchema.parse({ categoryId: 1, subCategoryId: 3, configurationId: 5, ingredientType: "fruit", isOrganic: false, requestedPallets: 2, rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 2, percentage: 50 }] })
const key = "01234567-89ab-4cde-8abc-0123456789ab"
function fixture() {
    const raw = (id: number) => ({ id, isActive: true, displayName: `Fruit ${id}`, isMixable: true, isOrganic: false, ingredientType: "fruit", costPerUnit: "1", costUnitId: 1, costUnit: { id: 1, isActive: true, displayName: "Pound", unitType: "weight", baseFactor: "453.592" } })
    const materials = [raw(1), raw(2)]
    const parent = { id: 4, isActive: true, isCustomizable: false, subCategoryId: 3, additionalCostPerUnit: 999, productIngredients: [{ grams: 99 }], productRawMaterials: materials.map(row => ({ isActive: true, rawMaterialId: row.id, minPercentage: 99, maxPercentage: 99, usedRawMaterial: row })) }
    const packaging = (id: number, role: string) => ({ id, isActive: true, displayName: `Material ${id}`, unitCost: "0.5", packagingRole: role })
    const variant = { id: 5, isActive: true, parentProduct: parent, skuCode: "PRIVATE-SKU", presentationId: 7, boxesPerPallet: 40, bagsPerBox: 6, unitsPerIntermediatePackage: 4,
        sizePresentation: { id: 7, isActive: true, displayLabel: "500 g", netWeightGrams: "500" },
        unitMaterials: [{ id: 11, isActive: true, packagingId: 101, optionGroup: null, isDefault: false, quantityPerUnit: 1, usedUnitMaterial: packaging(101, "unit") }],
        intermediateMaterials: [{ id: 21, isActive: true, packagingId: 201, optionGroup: null, isDefault: false, usedIntermediateMaterial: packaging(201, "intermediate") }],
        palletMaterials: [
            { id: 31, isActive: true, packagingId: 301, optionGroupId: 1, optionGroup: "BOX", isDefault: true, quantityBasis: "per_box", quantityValue: 1, usedPalletMaterial: packaging(301, "pallet") },
            { id: 32, isActive: true, packagingId: 302, optionGroupId: 1, optionGroup: "BOX", isDefault: false, quantityBasis: "per_box", quantityValue: 1, usedPalletMaterial: packaging(302, "pallet") },
            { id: 33, isActive: true, packagingId: 303, optionGroup: null, isDefault: false, quantityBasis: "per_pallet", quantityValue: 2, usedPalletMaterial: packaging(303, "pallet") },
        ] }
    mock(Product.findAll).mockResolvedValue([parent]); mock(ProductVariant.findAll).mockResolvedValue([variant])
    mock(SubCategory.findAll).mockResolvedValue([{ id: 3, categoryId: 1, displayName: "Fruit blends", parentCategory: { id: 1, displayName: "Frozen" } }])
    mock(ProcessingCost.findAll).mockResolvedValue([]); mock(CustomQuote.findOne).mockResolvedValue(null)
    mock(CustomQuote.sequelize!.transaction).mockImplementation(async (_options, work: (transaction: Transaction) => Promise<unknown>) => work({} as Transaction))
    mock(CustomQuote.sequelize!.query).mockResolvedValue([])
    mock(CustomQuote.create).mockImplementation(async data => ({ ...data, id: 88, get: () => new Date(), toJSON: () => ({ ...data, id: 88, createdAt: new Date() }) }))
    return { materials, parent, variant }
}
beforeEach(() => { process.env.JWT_SECRET = "catalog-test-secret"; fixture() })
afterEach(() => {
    for (const legacy of [CustomQuoteRawMaterialOption, CustomQuoteIngredientOption, CustomQuotePresentationOption, CustomQuotePackagingOption]) {
        expect(legacy.findAll).not.toHaveBeenCalled()
        expect(legacy.findOne).not.toHaveBeenCalled()
    }
})

it("admin calculator uses official prices without confirmation, customer records or a preview token", async () => {
    const result = await previewAdminCatalogQuote(input, "en")
    const expected = await calculateCatalogQuote(input, "en")
    expect(result.totalCost).toBe(expected.totalCost)
    expect(result.totalUnits).toBe(480)
    expect(result.configuration.rawMaterialMix).toEqual(input.rawMaterialMix)
    expect(result.breakdown.palletMaterials).toEqual(expected.breakdown.palletMaterials)
    expect(result).not.toHaveProperty("id")
    expect(result).not.toHaveProperty("status")
    expect(result).not.toHaveProperty("previewToken")
    expect(result).not.toHaveProperty("salespersonId")
    expect(result.configuration.snapshot).not.toHaveProperty("capturedAt")
    expect(CustomQuote.create).not.toHaveBeenCalled()
    expect(CustomQuote.findOne).not.toHaveBeenCalled()
    expect(CustomQuote.sequelize!.query).not.toHaveBeenCalled()
    expect(Product.create).not.toHaveBeenCalled()
    expect(ProductVariant.create).not.toHaveBeenCalled()
    expect(Lead.create).not.toHaveBeenCalled()
    expect(Quote.create).not.toHaveBeenCalled()
    expect(QuoteDraft.create).not.toHaveBeenCalled()
    expect(QuoteDraft.upsert).not.toHaveBeenCalled()
    expect(Salesperson.create).not.toHaveBeenCalled()
})

it("discovers ordinary active products, deduplicates materials/configurations, excludes source names/SKU", async () => {
    const { variant, parent } = fixture()
    mock(Product.findAll).mockResolvedValue([parent, parent])
    mock(ProductVariant.findAll).mockResolvedValue([variant, { ...variant, id: 6, skuCode: "OTHER", unitMaterials: variant.unitMaterials.map(row => ({ ...row, id: 999 })) }])
    const catalog = await discoverCatalog("en")
    expect(catalog.categories[0].subCategories[0].rawMaterials).toHaveLength(2)
    expect(catalog.categories[0].subCategories[0].configurations).toHaveLength(1)
    expect(JSON.stringify(catalog)).not.toContain("PRIVATE-SKU")
})
it("fingerprints ignore row IDs/SKU and collection order but preserve meaningful differences", () => {
    const { variant } = fixture(); const typed = variant as unknown as ProductVariant
    const original = digest(configurationIdentity(typed, 3))
    const changed = { ...variant, skuCode: "OTHER", palletMaterials: [...variant.palletMaterials].reverse().map(row => ({ ...row, id: row.id + 100 })) } as unknown as ProductVariant
    expect(digest(configurationIdentity(changed, 3))).toBe(original)
    for (const value of [{ ...variant, boxesPerPallet: 198 }, { ...variant, unitsPerIntermediatePackage: 8 }, { ...variant, palletMaterials: variant.palletMaterials.map(row => ({ ...row, quantityValue: 2 })) }]) expect(digest(configurationIdentity(value as unknown as ProductVariant, 3))).not.toBe(original)
})
it.each(["inactiveVariant", "inactivePresentation", "inactivePackaging", "noDefault", "multipleDefaults", "wrongRole", "missingIntermediate"])("excludes invalid configuration: %s", mode => {
    const { variant } = fixture()
    if (mode === "inactiveVariant") variant.isActive = false
    if (mode === "inactivePresentation") variant.sizePresentation.isActive = false
    if (mode === "inactivePackaging") variant.unitMaterials[0].usedUnitMaterial.isActive = false
    if (mode === "noDefault") variant.palletMaterials[0].isDefault = false
    if (mode === "multipleDefaults") variant.palletMaterials[1].isDefault = true
    if (mode === "wrongRole") variant.unitMaterials[0].usedUnitMaterial.packagingRole = "pallet"
    if (mode === "missingIntermediate") variant.unitsPerIntermediatePackage = 0
    expect(validConfiguration(variant as unknown as ProductVariant)).toBe(false)
})
it.each(["vegetable", "pulp", "organic", "nonMixable", "inactive", "badUnit"])("rejects incompatible raw material: %s", async mode => {
    const { materials } = fixture()
    if (mode === "vegetable" || mode === "pulp") materials[1].ingredientType = mode
    if (mode === "organic") materials[1].isOrganic = true
    if (mode === "nonMixable") materials[1].isMixable = false
    if (mode === "inactive") materials[1].isActive = false
    if (mode === "badUnit") materials[1].costUnit.baseFactor = "0"
    await expect(calculateCatalogQuote(input, "en")).rejects.toMatchObject({ statusCode: 422 })
})
it.each([99.99,100.01])("rejects %s percent exactly", async percentage => {
    await expect(calculateCatalogQuote({ ...input, rawMaterialMix: [{ rawMaterialId: 1, percentage }] }, "en")).rejects.toMatchObject({ key: "errors.catalog_quote_total_100" })
})
it("rejects duplicates, wrong context and foreign packaging", async () => {
    await expect(calculateCatalogQuote({ ...input, rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 1, percentage: 50 }] }, "en")).rejects.toMatchObject({ statusCode: 422 })
    await expect(calculateCatalogQuote({ ...input, subCategoryId: 99 }, "en")).rejects.toMatchObject({ statusCode: 422 })
    await expect(calculateCatalogQuote({ ...input, selectedPalletMaterialIds: [999] }, "en")).rejects.toMatchObject({ statusCode: 422 })
})
it("accepts exact mix, fixed/default/alternative, ceil intermediate, box/pallet quantities; never inherits recipe costs", async () => {
    const calculation = await calculateCatalogQuote({ ...input, selectedPalletMaterialIds: [32] }, "en")
    expect(calculation.totalUnits).toBe(480); expect(calculation.ingredientCost).toBe(0); expect(calculation.adjustmentCost).toBe(0)
    expect(calculation.unitPackagingCost).toBe(240); expect(calculation.intermediatePackagingCost).toBe(60); expect(calculation.palletMaterialCost).toBe(42)
    expect(calculation.configuration.snapshot.packaging.map(row => row.selectionOrigin)).toEqual(["fixed", "fixed", "customer", "fixed"])
    expect(Product.create).not.toHaveBeenCalled(); expect(ProductVariant.create).not.toHaveBeenCalled(); expect(CustomQuote.create).not.toHaveBeenCalled()
})
it("confirms snapshot, removes internal source data from client and retries idempotently", async () => {
    const preview = await previewCatalogQuote(42, input, "en")
    expect(JSON.stringify(preview)).not.toContain("PRIVATE-SKU")
    const confirmed = await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")
    const saved = mock(CustomQuote.create).mock.calls[0][0]
    expect(saved.configuration.snapshot.source.skuCode).toBe("PRIVATE-SKU")
    expect(saved.configuration.snapshot.capturedAt).toBeTruthy()
    mock(CustomQuote.findOne).mockResolvedValue({ toJSON: () => ({ ...saved, id: 88, createdAt: new Date() }) })
    const retry = await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")
    expect(retry.id).toBe(confirmed.id); expect(CustomQuote.create).toHaveBeenCalledTimes(1)
})
it("persists mixed order identity and rejects retries that change its customer", async () => {
    const order = { id: "5e226064-21be-4a9a-a5e5-f312391e363a", clientName: "Customer A" }
    const preview = await previewCatalogQuote(42, input, "en")
    await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key, order }, "en")
    const saved = mock(CustomQuote.create).mock.calls[0][0]
    expect(saved.breakdown.order).toEqual(order)
    expect(saved.breakdown.production).toMatchObject({ kind: "customizable" })
    mock(CustomQuote.findOne).mockResolvedValue({ toJSON: () => ({ ...saved, id: 88, createdAt: new Date() }) })
    await expect(confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key, order: { ...order, clientName: "Customer B" } }, "en")).rejects.toMatchObject({ statusCode: 409 })
    expect(CustomQuote.create).toHaveBeenCalledTimes(1)
})
it.each(["rawCost", "packagingCost", "alternativeCost", "default", "weight", "additionalCost"])("preview/confirm conflicts after %s changes", async mode => {
    const { materials, variant } = fixture(); const preview = await previewCatalogQuote(42, input, "en")
    if (mode === "rawCost") materials[0].costPerUnit = "2"
    if (mode === "packagingCost") variant.unitMaterials[0].usedUnitMaterial.unitCost = "2"
    if (mode === "alternativeCost") variant.palletMaterials[1].usedPalletMaterial.unitCost = "2"
    if (mode === "default") { variant.palletMaterials[0].isDefault = false; variant.palletMaterials[1].isDefault = true }
    if (mode === "weight") variant.sizePresentation.netWeightGrams = "1000"
    if (mode === "additionalCost") mock(ProcessingCost.findAll).mockResolvedValue([{ id: 9, displayName: "Fee", calculationType: "percentage", value: 5 }])
    await expect(confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")).rejects.toMatchObject({ statusCode: 409 })
    expect(CustomQuote.create).not.toHaveBeenCalled()
})
it("rejects forged/another representative/modified request previews", async () => {
    const preview = await previewCatalogQuote(42, input, "en")
    for (const request of [{ input, previewToken: "forged", confirmationKey: key }, { input: { ...input, requestedPallets: 3 }, previewToken: preview.previewToken, confirmationKey: key }]) await expect(confirmCatalogQuote(42, request, "en")).rejects.toMatchObject({ statusCode: 409 })
    await expect(confirmCatalogQuote(43, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")).rejects.toMatchObject({ statusCode: 409 })
})
it("snapshot remains unchanged after catalog changes", async () => {
    const { variant, materials } = fixture(); const calculation = await calculateCatalogQuote(input, "en")
    const snapshot = JSON.stringify(calculation.configuration.snapshot)
    variant.boxesPerPallet = 999; variant.unitMaterials[0].usedUnitMaterial.displayName = "Renamed"; materials[0].costPerUnit = "99"
    expect(JSON.stringify(calculation.configuration.snapshot)).toBe(snapshot)
})
it("strict contract rejects authoritative logistics/costs and unsupported fields", () => {
    for (const extra of [{ totalCost: 1 }, { boxesPerPallet: 999 }, { ingredients: [] }, { sourceSkuCode: "x" }]) expect(catalogQuoteInputSchema.safeParse({ ...input, ...extra }).success).toBe(false)
})
it("accepts same-type organic/pulp composition without relying on source Product certification", async () => {
    const { materials, parent } = fixture()
    parent.isCustomizable = false
    materials.forEach(raw => { raw.isOrganic = true; raw.ingredientType = "pulp" })
    const result = await calculateCatalogQuote({ ...input, isOrganic: true, ingredientType: "pulp" }, "en")
    expect(result.isOrganic).toBe(true)
    expect(result.configuration.snapshot.ingredientType).toBe("pulp")
})
it("inactive source/presentation or removed association between preview and confirm returns 409", async () => {
    const { variant } = fixture(); const preview = await previewCatalogQuote(42, input, "en")
    variant.isActive = false
    await expect(confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")).rejects.toMatchObject({ statusCode: 409 })
    expect(CustomQuote.create).not.toHaveBeenCalled()
})
it("retries a stale concurrent transaction snapshot using a new consistent transaction", async () => {
    const preview = await previewCatalogQuote(42, input, "en")
    mock(CustomQuote.sequelize!.transaction).mockRejectedValueOnce({ original: { code: "23505", constraint: "customQuotes_confirmation_unique" } })
    const result = await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")
    expect(result.id).toBe(88)
    expect(CustomQuote.sequelize!.query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), expect.objectContaining({ transaction: expect.any(Object) }))
})
it("idempotency key cannot be reused for another composition/quantity", async () => {
    const preview = await previewCatalogQuote(42, input, "en")
    await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")
    const saved = mock(CustomQuote.create).mock.calls[0][0]
    mock(CustomQuote.findOne).mockResolvedValue({ toJSON: () => ({ ...saved, id: 88 }) })
    const changedInput = { ...input, requestedPallets: 3 }
    const changedPreview = await previewCatalogQuote(42, changedInput, "en")
    await expect(confirmCatalogQuote(42, { input: changedInput, previewToken: changedPreview.previewToken, confirmationKey: key }, "en")).rejects.toMatchObject({ statusCode: 409 })
    expect(CustomQuote.create).toHaveBeenCalledTimes(1)
})
it("normalized request ordering does not invalidate the reviewed calculation", async () => {
    const preview = await previewCatalogQuote(42, input, "en")
    const result = await confirmCatalogQuote(42, { input: { ...input, rawMaterialMix: [...input.rawMaterialMix].reverse() }, previewToken: preview.previewToken, confirmationKey: key }, "en")
    expect(result.id).toBe(88)
})
