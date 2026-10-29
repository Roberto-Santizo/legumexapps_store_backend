jest.mock("../../genericPackaging/services/genericPackaging.service", () => ({ loadGenericProfiles: jest.fn() }))
import { loadGenericProfiles } from "../../genericPackaging/services/genericPackaging.service"
import { assertQuoteOrderOpen } from "../../quoteReview/services/quoteOrderLock"
jest.mock("../../juice/models/Juice.model", () => ({ __esModule: true, default: { findAll: jest.fn().mockResolvedValue([]) } }))
jest.mock("../../product/models/Product.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../../ingredient/models/Ingredient.model", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn() } }))
jest.mock("../../product/models/ProductVariant.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../../category/models/SubCategory.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../rawMaterial/models/RawMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../palletKit/services/palletKit.service", () => ({ ...jest.requireActual("../../palletKit/services/palletKit.service"), loadPalletKit: jest.fn() }))
jest.mock("../../processingCost/models/ProcessingCost.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/CustomQuote.model", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn(), sequelize: { transaction: jest.fn(), query: jest.fn() } } }))
// Bloqueo y estado del pedido (pedido aprobado = 409): probados contra PostgreSQL real.
jest.mock("../../quoteReview/services/quoteOrderLock", () => ({ assertQuoteOrderOpen: jest.fn() }))
jest.mock("../../lead/models/Lead.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../../quote/models/Quote.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../../quoteDraft/models/QuoteDraft.model", () => ({ __esModule: true, default: { create: jest.fn(), upsert: jest.fn() } }))
jest.mock("../../salesperson/models/Salesperson.model", () => ({ __esModule: true, default: { create: jest.fn() } }))

import Product from "../../product/models/Product.model"
import Juice from "../../juice/models/Juice.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import ProductVariant from "../../product/models/ProductVariant.model"
import SubCategory from "../../category/models/SubCategory.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import { loadPalletKit } from "../../palletKit/services/palletKit.service"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import CustomQuote from "../models/CustomQuote.model"
import Lead from "../../lead/models/Lead.model"
import Quote from "../../quote/models/Quote.model"
import QuoteDraft from "../../quoteDraft/models/QuoteDraft.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import { catalogQuoteInputSchema } from "../schemas/catalogQuote.schema"
import { discoverCatalog } from "./catalogQuoteDiscovery.service"
import { calculateCatalogQuote, previewCatalogQuote, confirmCatalogQuote, previewAdminCatalogQuote } from "./catalogQuote.service"
import { Transaction } from "sequelize"

const mock = (fn: unknown) => fn as jest.Mock
const input = catalogQuoteInputSchema.parse({ categoryId: 1, subCategoryId: 3, configurationId: 5, ingredientType: "fruit", requestedPallets: 2, packagingSelections: [{ groupId: 3, optionIds: [31] }], rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 2, percentage: 50 }] })
const key = "01234567-89ab-4cde-8abc-0123456789ab"
function fixture() {
    const raw = (id: number) => ({ id, isActive: true, displayName: `Fruit ${id}`, isOrganic: false, ingredientType: "fruit", costPerUnit: "1", costUnitId: 1, costUnit: { id: 1, isActive: true, displayName: "Pound", unitType: "weight", baseFactor: "453.592" } })
    const materials = [raw(1), raw(2)]
    const parent = { id: 4, isActive: true, subCategoryId: 3, additionalCostPerUnit: 999, productIngredients: [{ grams: 99 }], productRawMaterials: materials.map(row => ({ isActive: true, rawMaterialId: row.id, usedRawMaterial: row })) }
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
    mock(loadGenericProfiles).mockImplementation(async () => [{ id: 5, reference: "GEN-PROFILE", displayName: "Generic profile", categoryId: 1, presentationId: variant.presentationId, bagsPerBox: variant.bagsPerBox, boxesPerPallet: variant.boxesPerPallet,
        unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage, isActive: variant.isActive, presentation: variant.sizePresentation,
        groups: [
            { id: 1, packagingGroupId: 1, level: "unit", selectionMode: "all", isRequired: true, isActive: true, group: { displayName: "Bag", isActive: true }, options: variant.unitMaterials.map(r => ({ id:r.id, packagingId:r.packagingId, quantityBasis:"per_unit", quantityValue:r.quantityPerUnit,isActive:true,packaging:{...r.usedUnitMaterial,classification:"generic"} })) },
            { id: 2, packagingGroupId: 2, level: "intermediate", selectionMode: "all", isRequired: true, isActive: true, group: { displayName: "Intermediate", isActive: true }, options: variant.intermediateMaterials.map(r => ({ id:r.id, packagingId:r.packagingId, quantityBasis:"per_intermediate", quantityValue:null,isActive:true,packaging:{...r.usedIntermediateMaterial,classification:"generic"} })) },
            { id: 3, packagingGroupId: 3, level: "pallet", selectionMode: "one", isRequired: true, isActive: true, group: { displayName: "Box", isActive: true }, options: variant.palletMaterials.filter(r=>r.optionGroup).map(r=>({id:r.id,packagingId:r.packagingId,quantityBasis:r.quantityBasis,quantityValue:r.quantityValue,isActive:true,packaging:{...r.usedPalletMaterial,classification:"generic"}})) },
            { id: 4, packagingGroupId: 4, level: "pallet", selectionMode: "all", isRequired: true, isActive: true, group: { displayName: "Pallet", isActive: true }, options: variant.palletMaterials.filter(r=>!r.optionGroup).map(r=>({id:r.id,packagingId:r.packagingId,quantityBasis:r.quantityBasis,quantityValue:r.quantityValue,isActive:true,packaging:{...r.usedPalletMaterial,classification:"generic"}})) },
        ] }])
    mock(Product.findAll).mockResolvedValue([parent]); mock(ProductVariant.findAll).mockResolvedValue([variant]); mock(RawMaterial.findAll).mockResolvedValue(materials)
    // Standard pallet kit: 1 tarima, 4 esquineros, 93.3 m stretch per pallet, each at $1.
    const kit = (id: number, displayName: string, palletKitType: string, quantity: string) => ({ id, displayName, classification: "generic", packagingRole: "pallet", isActive: true, unitCost: "1", palletKitType, defaultQuantityBasis: "per_pallet", defaultQuantityValue: quantity })
    mock(loadPalletKit).mockResolvedValue([{ type: "TARIMA", options: [kit(901, "Kit tarima", "TARIMA", "1.00")] }, { type: "ESQUINERO", options: [kit(902, "Kit esquinero", "ESQUINERO", "4.00")] }, { type: "STRETCH", options: [kit(903, "Kit stretch", "STRETCH", "93.30")] }])
    mock(SubCategory.findAll).mockResolvedValue([{ id: 3, categoryId: 1, displayName: "Fruit blends", parentCategory: { id: 1, displayName: "Frozen" } }])
    mock(ProcessingCost.findAll).mockResolvedValue([]); mock(CustomQuote.findOne).mockResolvedValue(null)
    mock(CustomQuote.sequelize!.transaction).mockImplementation(async (_options, work: (transaction: Transaction) => Promise<unknown>) => work({} as Transaction))
    mock(CustomQuote.sequelize!.query).mockResolvedValue([])
    mock(CustomQuote.create).mockImplementation(async data => ({ ...data, id: 88, get: () => new Date(), toJSON: () => ({ ...data, id: 88, createdAt: new Date() }) }))
    return { materials, parent, variant }
}
beforeEach(() => { process.env.JWT_SECRET = "catalog-test-secret"; fixture() })

test("linked juices cannot enter customizable weight-based product discovery", async () => {
    const { parent, variant } = fixture()
    Object.assign(variant, { productId: parent.id })
    jest.mocked(Juice.findAll).mockResolvedValueOnce([{ productId: parent.id, isActive: false }] as never)
    const [subCategory] = (await discoverCatalog("es")).categories[0].subCategories
    expect(subCategory).toMatchObject({ availability: "missing_recipe", compositionMode: null, rawMaterials: [], configurations: [] })
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
it.each(["vegetable", "pulp", "inactive", "badUnit"])("rejects incompatible raw material: %s", async mode => {
    const { materials } = fixture()
    if (mode === "vegetable" || mode === "pulp") materials[1].ingredientType = mode
    if (mode === "inactive") materials[1].isActive = false
    if (mode === "badUnit") materials[1].costUnit.baseFactor = "0"
    await expect(calculateCatalogQuote(input, "en")).rejects.toMatchObject({ statusCode: 422 })
})
it.each([99.99,100.01])("rejects %s percent exactly", async percentage => {
    await expect(calculateCatalogQuote({ ...input, rawMaterialMix: [{ rawMaterialId: 1, percentage }] }, "en")).rejects.toMatchObject({ key: "errors.catalog_quote_total_100" })
})

it.each([false, true, undefined])("discovers and costs eligible raw materials independently of historical isMixable=%s", async historical => {
    const { materials } = fixture()
    const baseline = await calculateCatalogQuote(input, "en")
    Object.assign(materials[1], { isMixable: historical })
    const catalog = await discoverCatalog("en")
    expect(catalog.categories[0].subCategories[0].rawMaterials.map(row => row.rawMaterialId)).toContain(2)
    const result = await calculateCatalogQuote(input, "en")
    expect(result.totalCost).toBe(baseline.totalCost)
    expect(result.breakdown).toEqual(baseline.breakdown)
})

it("eligible pool is the active catalog of the recipe type: never another type or ingredient-only records", async () => {
    const { materials } = fixture()
    const otherFruit = { ...materials[0], id: 999, displayName: "Catalog fruit" }
    const vegetable = { ...materials[0], id: 777, displayName: "Broccoli", ingredientType: "vegetable" }
    mock(RawMaterial.findAll).mockResolvedValue([...materials, otherFruit, vegetable])
    mock(Ingredient.findAll).mockResolvedValue([{ id: 888, displayName: "Ingredient only" }, { id: 1, displayName: "Ingredient with overlapping ID" }])
    const catalog = await discoverCatalog("en")
    expect(catalog.categories[0].subCategories[0].rawMaterials.map(row => row.rawMaterialId)).toEqual([1, 2, 999])
    expect(JSON.stringify(catalog)).not.toContain("Ingredient only")
    expect(JSON.stringify(catalog)).not.toContain("Broccoli")
    expect((await calculateCatalogQuote({ ...input, rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 999, percentage: 50 }] }, "en")).totalUnits).toBe(480)
    for (const rawMaterialId of [777, 888]) {
        await expect(calculateCatalogQuote({ ...input, rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId, percentage: 50 }] }, "en"))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.catalog_quote_composition_invalid" })
    }
    await expect(calculateCatalogQuote({ ...input, ingredientType: "vegetable", rawMaterialMix: [{ rawMaterialId: 777, percentage: 100 }] }, "en"))
        .rejects.toMatchObject({ statusCode: 422, key: "errors.catalog_quote_composition_invalid" })
    await expect(calculateCatalogQuote({ ...input, categoryId: 99 }, "en")).rejects.toMatchObject({ statusCode: 422 })
    expect(Ingredient.findAll).not.toHaveBeenCalled()
    expect(Ingredient.findOne).not.toHaveBeenCalled()
})
it("rejects duplicates, wrong context and foreign packaging", async () => {
    await expect(calculateCatalogQuote({ ...input, rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 1, percentage: 50 }] }, "en")).rejects.toMatchObject({ statusCode: 422 })
    await expect(calculateCatalogQuote({ ...input, subCategoryId: 99 }, "en")).rejects.toMatchObject({ statusCode: 422 })
    await expect(Promise.resolve().then(() => catalogQuoteInputSchema.parse({ ...input, selectedPalletMaterialIds: [999] }))).rejects.toThrow()
})
it("accepts exact mix, fixed/default/alternative, ceil intermediate, box/pallet quantities; never inherits recipe costs", async () => {
    const calculation = await calculateCatalogQuote({ ...input, packagingSelections: [{ groupId: 3, optionIds: [32] }] }, "en")
    expect(calculation.totalUnits).toBe(480); expect(calculation.ingredientCost).toBe(0); expect(calculation.adjustmentCost).toBe(0)
    expect(calculation.unitPackagingCost).toBe(240); expect(calculation.intermediatePackagingCost).toBe(60); expect(calculation.palletMaterialCost).toBe(42 + 2 * (1 + 4 + 93.3))
    expect(calculation.configuration.snapshot.packaging.map(row => row.selectionOrigin)).toEqual(["included", "included", "customer", "included", "included", "included", "included"])
    expect(Product.create).not.toHaveBeenCalled(); expect(ProductVariant.create).not.toHaveBeenCalled(); expect(CustomQuote.create).not.toHaveBeenCalled()
})
it("confirms snapshot, removes internal source data from client and retries idempotently", async () => {
    const preview = await previewCatalogQuote(42, input, "en")
    expect(JSON.stringify(preview)).not.toContain("PRIVATE-SKU")
    const confirmed = await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")
    const saved = mock(CustomQuote.create).mock.calls[0][0]
    expect(saved.configuration.snapshot.source.genericConfigurationId).toBe(5)
    expect(saved.sourceProductVariantId).toBeNull()
    expect(saved.snapshotVersion).toBe(3)
    expect(saved.configuration.snapshot.capturedAt).toBeTruthy()
    mock(CustomQuote.findOne).mockResolvedValue({ toJSON: () => ({ ...saved, id: 88, createdAt: new Date() }) })
    const retry = await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")
    expect(retry.id).toBe(confirmed.id); expect(CustomQuote.create).toHaveBeenCalledTimes(1)
})
it("the representative never receives an amount: preview, confirmation and retry; the saved snapshot and the admin calculator keep every cost", async () => {
    const amountKeys = (value: unknown, path = ""): string[] => !value || typeof value !== "object" ? [] : Object.entries(value).flatMap(([key, child]) =>
        [...(/cost|total$|lineTotal|baseAmount|value$/i.test(key) && !/^(totalUnits|totalBoxes|totalWeightGrams|totalQuantity|quantityValue)$/.test(key) ? [`${path}${key}`] : []), ...amountKeys(child, `${path}${key}.`)])
    const preview = await previewCatalogQuote(42, input, "en")
    const confirmed = await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")
    const saved = mock(CustomQuote.create).mock.calls[0][0]
    mock(CustomQuote.findOne).mockResolvedValue({ toJSON: () => ({ ...saved, id: 88, createdAt: new Date() }) })
    const retry = await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")
    for (const result of [preview, confirmed, retry]) {
        expect(amountKeys(result)).toEqual([])
        expect(result).toMatchObject({ totalUnits: 480, configuration: { rawMaterialMix: input.rawMaterialMix, snapshot: { quantity: { totalUnits: 480 } } } })
        expect(result.breakdown.palletMaterials.length).toBeGreaterThan(0)
    }
    expect(saved.totalCost).toBeGreaterThan(0)
    expect(saved.configuration.snapshot.costs.totalCost).toBe(saved.totalCost)
    expect((await previewAdminCatalogQuote(input, "en")).totalCost).toBe(saved.totalCost)
})
it("persists mixed order identity and rejects retries that change its customer", async () => {
    const order = { id: "5e226064-21be-4a9a-a5e5-f312391e363a", clientName: "Customer A" }
    const preview = await previewCatalogQuote(42, input, "en")
    await confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key, order }, "en")
    const saved = mock(CustomQuote.create).mock.calls[0][0]
    expect(saved.breakdown.order).toEqual(order)
    expect(saved.breakdown.production).toMatchObject({ kind: "customizable" })
    // The line is stored only after checking that its order is still open.
    expect(assertQuoteOrderOpen).toHaveBeenCalledWith(order.id, expect.anything())
    expect(mock(assertQuoteOrderOpen).mock.invocationCallOrder[0]).toBeLessThan(mock(CustomQuote.create).mock.invocationCallOrder[0])
    // READ COMMITTED: the order check must see an approval committed while it waited for the order lock.
    expect(mock(CustomQuote.sequelize!.transaction).mock.calls.at(-1)?.[0]).toEqual({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED })
    expect(mock(CustomQuote.sequelize!.transaction).mock.calls[0][0]).toEqual({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ })
    mock(CustomQuote.findOne).mockResolvedValue({ toJSON: () => ({ ...saved, id: 88, createdAt: new Date() }) })
    await expect(confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key, order: { ...order, clientName: "Customer B" } }, "en")).rejects.toMatchObject({ statusCode: 409 })
    expect(CustomQuote.create).toHaveBeenCalledTimes(1)
})
it.each(["rawCost", "packagingCost", "alternativeCost", "requirements", "weight", "additionalCost"])("preview/confirm conflicts after %s changes", async mode => {
    const { materials, variant } = fixture(); const preview = await previewCatalogQuote(42, input, "en")
    if (mode === "rawCost") materials[0].costPerUnit = "2"
    if (mode === "packagingCost") variant.unitMaterials[0].usedUnitMaterial.unitCost = "2"
    if (mode === "alternativeCost") variant.palletMaterials[1].usedPalletMaterial.unitCost = "2"
    if (mode === "requirements") { const profiles = await loadGenericProfiles(); profiles[0].groups[2].isRequired = false; mock(loadGenericProfiles).mockResolvedValue(profiles) }
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
it("new products have no certification choice: same-type pulp composition works and isOrganic is rejected", async () => {
    const { materials } = fixture()
    materials.forEach(raw => { raw.ingredientType = "pulp" })
    const result = await calculateCatalogQuote({ ...input, ingredientType: "pulp" }, "en")
    expect(result.configuration.snapshot.ingredientType).toBe("pulp")
    expect(result.configuration.snapshot).not.toHaveProperty("isOrganic")
    expect(result).not.toHaveProperty("isOrganic")
    expect(catalogQuoteInputSchema.safeParse({ ...input, isOrganic: true }).success).toBe(false)
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

describe("composition mode from fixed recipes", () => {
    it("recipes with one distinct raw material are single, even repeated across products", async () => {
        const { parent, materials } = fixture()
        const single = { ...parent, productRawMaterials: [{ isActive: true, rawMaterialId: 1, usedRawMaterial: materials[0] }] }
        mock(Product.findAll).mockResolvedValue([single, { ...single, id: 5 }, { ...single, id: 6, productRawMaterials: [...single.productRawMaterials, { isActive: false, rawMaterialId: 2, usedRawMaterial: materials[1] }] }])
        const [subCategory] = (await discoverCatalog("en")).categories[0].subCategories
        expect(subCategory).toMatchObject({ availability: "ready", compositionMode: "single" })
        expect(subCategory.rawMaterials.map(row => row.rawMaterialId)).toEqual([1, 2])
        const result = await calculateCatalogQuote({ ...input, rawMaterialMix: [{ rawMaterialId: 2, percentage: 100 }] }, "en")
        expect(result.productDisplayName).toBe("Fruit 2")
        expect(result.configuration.snapshot.compositionMode).toBe("single")
        await expect(calculateCatalogQuote(input, "en")).rejects.toMatchObject({ statusCode: 422, key: "errors.catalog_quote_composition_invalid" })
    })
    it("any recipe with two distinct raw materials is a blend that requires at least two", async () => {
        const [subCategory] = (await discoverCatalog("en")).categories[0].subCategories
        expect(subCategory.compositionMode).toBe("blend")
        expect((await calculateCatalogQuote(input, "en")).configuration.snapshot.compositionMode).toBe("blend")
        await expect(calculateCatalogQuote({ ...input, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }] }, "en")).rejects.toMatchObject({ key: "errors.catalog_quote_composition_invalid" })
    })
    it("without reference recipes the subcategory is not classified and cannot be quoted", async () => {
        const { parent } = fixture()
        mock(Product.findAll).mockResolvedValue([{ ...parent, productRawMaterials: [] }])
        const [subCategory] = (await discoverCatalog("en")).categories[0].subCategories
        expect(subCategory).toMatchObject({ availability: "missing_recipe", compositionMode: null, rawMaterials: [], configurations: [] })
        await expect(calculateCatalogQuote(input, "en")).rejects.toMatchObject({ key: "errors.catalog_quote_context_invalid" })
    })
    it("reports missing configuration and never offers configurations that are not ready", async () => {
        const profiles = await loadGenericProfiles()
        profiles[0].groups[2].options = []
        mock(loadGenericProfiles).mockResolvedValue(profiles)
        const [subCategory] = (await discoverCatalog("en")).categories[0].subCategories
        expect(subCategory).toMatchObject({ availability: "missing_configuration", configurations: [] })
        expect(subCategory.rawMaterials).toHaveLength(2)
    })
})

describe("standard pallet kit for new products", () => {
    it("adds tarima, esquineros and stretch per pallet from the catalog, frozen in the snapshot", async () => {
        const calculation = await calculateCatalogQuote(input, "es")
        const kitRows = calculation.configuration.snapshot.packaging.filter(row => row.optionGroup === "Kit de paletizado")
        expect(kitRows.map(row => [row.packagingId, row.quantityValue, row.effectiveQuantity, row.lineTotal])).toEqual([[901, 1, 2, 2], [902, 4, 8, 8], [903, 93.3, 186.6, 186.6]])
        expect(calculation.breakdown.palletMaterials.slice(-3).map(line => line.optionGroup)).toEqual(["Kit de paletizado", "Kit de paletizado", "Kit de paletizado"])
        expect((await discoverCatalog("en")).palletKit.map(part => [part.type, part.group, part.options.map(option => option.displayName)])).toEqual([["TARIMA", "Pallet", ["Kit tarima"]], ["ESQUINERO", "Corner boards", ["Kit esquinero"]], ["STRETCH", "Stretch film", ["Kit stretch"]]])
    })
    it("an incomplete kit blocks new-product quotes and is reported in discovery", async () => {
        const kit = await loadPalletKit()
        mock(loadPalletKit).mockResolvedValue([{ type: "TARIMA", options: [] }, kit[1], kit[2]])
        await expect(calculateCatalogQuote(input, "en")).rejects.toMatchObject({ statusCode: 422, key: "errors.pallet_kit_missing" })
        expect((await discoverCatalog("en")).categories[0].subCategories[0]).toMatchObject({ availability: "missing_pallet_kit", configurations: [] })
    })
    it("a configuration that contains a kit material is rejected instead of charging it twice", async () => {
        const profiles = await loadGenericProfiles()
        profiles[0].groups[3].options[0].packagingId = 901
        mock(loadGenericProfiles).mockResolvedValue(profiles)
        await expect(calculateCatalogQuote(input, "en")).rejects.toMatchObject({ statusCode: 422, key: "errors.catalog_quote_configuration_invalid" })
    })
    it("a kit cost change between preview and confirmation is a conflict", async () => {
        const preview = await previewCatalogQuote(42, input, "en")
        const kit = await loadPalletKit()
        mock(loadPalletKit).mockResolvedValue(kit.map(part => ({ ...part, options: part.options.map(option => ({ ...option, unitCost: "2" })) })))
        await expect(confirmCatalogQuote(42, { input, previewToken: preview.previewToken, confirmationKey: key }, "en")).rejects.toMatchObject({ statusCode: 409 })
        expect(CustomQuote.create).not.toHaveBeenCalled()
    })
    it("with several materials of a type the representative chooses one; its quantity stays the type's", async () => {
        const kit = await loadPalletKit()
        const wooden = { ...kit[1].options[0], id: 904, displayName: "Esquinero de madera", unitCost: "3" }
        mock(loadPalletKit).mockResolvedValue([kit[0], { type: "ESQUINERO", options: [kit[1].options[0], wooden] }, kit[2]])
        await expect(calculateCatalogQuote(input, "en")).rejects.toMatchObject({ statusCode: 422, key: "errors.pallet_kit_choice" })
        const chosen = await calculateCatalogQuote({ ...input, palletKitSelections: [{ type: "ESQUINERO", packagingId: 904 }] }, "en")
        const row = chosen.configuration.snapshot.packaging.find(line => line.packagingId === 904)!
        expect(row).toMatchObject({ quantityValue: 4, effectiveQuantity: 8, lineTotal: 24, selectionOrigin: "customer" })
        expect(chosen.configuration.snapshot.packaging.some(line => line.packagingId === 902)).toBe(false)
        for (const palletKitSelections of [[{ type: "ESQUINERO" as const, packagingId: 903 }], [{ type: "ESQUINERO" as const, packagingId: 904 }, { type: "ESQUINERO" as const, packagingId: 902 }], [{ type: "TARIMA" as const, packagingId: 999 }, { type: "ESQUINERO" as const, packagingId: 904 }]])
            await expect(calculateCatalogQuote({ ...input, palletKitSelections }, "en")).rejects.toMatchObject({ key: "errors.pallet_kit_selection" })
        expect(catalogQuoteInputSchema.safeParse({ ...input, palletKitSelections: [{ type: "ESQUINERO", packagingId: 904, quantity: 2 }] }).success).toBe(false)
    })
})

it("invalidates a preview if an unselected kit alternative changes", async () => {
    const kit = await loadPalletKit()
    kit[0].options.push({ ...kit[0].options[0], id: 999 } as never)
    const selected = { ...input, palletKitSelections: [{ type: "TARIMA" as const, packagingId: 901 }] }
    const preview = await previewCatalogQuote(42, selected, "en")
    kit[0].options[1].unitCost = 99
    await expect(confirmCatalogQuote(42, { input: selected, previewToken: preview.previewToken, confirmationKey: key }, "en")).rejects.toMatchObject({ statusCode: 409 })
    expect(CustomQuote.create).not.toHaveBeenCalled()
})
