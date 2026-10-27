jest.mock("../../../database/connection", () => ({ __esModule: true, default: {} }))
jest.mock("./quote.service", () => ({ quoteService: { calculateQuote: jest.fn(), saveQuote: jest.fn(), listQuotableProducts: jest.fn() } }))
jest.mock("../../product/models/ProductVariant.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn() } }))
jest.mock("../../juice/models/Juice.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn() } }))
jest.mock("../../client/models/Client.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../models/Quote.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../../quoteDraft/services/quoteDraft.service", () => ({ quoteDraftService: { markConverted: jest.fn() } }))
jest.mock("../../juice/services/juiceRecipe.service", () => ({ loadJuiceRecipe: jest.fn() }))
jest.mock("../../palletKit/services/palletKit.service", () => ({ ...jest.requireActual("../../palletKit/services/palletKit.service"), loadPalletKit: jest.fn() }))

import Variant from "../../product/models/ProductVariant.model"
import Juice from "../../juice/models/Juice.model"
import Client from "../../client/models/Client.model"
import Quote from "../models/Quote.model"
import { quoteService } from "./quote.service"
import { quoteDraftService } from "../../quoteDraft/services/quoteDraft.service"
import { loadJuiceRecipe } from "../../juice/services/juiceRecipe.service"
import { calculateLinkedJuice, fixedQuoteService } from "./fixedQuote.service"
import { loadPalletKit } from "../../palletKit/services/palletKit.service"

const packaging = (id: number, role: string, unitCost: number) => ({ id, code: `PK-${id}`, displayName: `Packaging ${id}`, isActive: true, classification: "specific", packagingRole: role, unitCost })
const fixed = { optionGroup: null, isDefault: false }
let variant: any
const juice = { id: 4, productId: 10, isActive: true } as Juice
const input = { productVariantId: 20, requestedPallets: 2 }
beforeEach(() => {
    jest.resetAllMocks()
    variant = { id: 20, productId: 10, skuCode: "SYN-JUICE", boxesPerPallet: 3, bagsPerBox: 2, unitsPerIntermediatePackage: 2,
        parentProduct: { id: 10, clientId: 9, displayName: "Synthetic juice", productRawMaterials: [], productIngredients: [], additionalCostPerUnit: 999 },
        sizePresentation: { id: 8, displayLabel: "1000 ml", netWeightGrams: 900, netVolumeMl: 1000 },
        unitMaterials: [{ id: 1, packagingId: 1, quantityPerUnit: 1, usedUnitMaterial: packaging(1, "unit", .1), ...fixed }],
        intermediateMaterials: [{ id: 2, packagingId: 2, usedIntermediateMaterial: packaging(2, "intermediate", .5), ...fixed }],
        palletMaterials: [{ id: 3, packagingId: 3, quantityValue: 1, quantityBasis: "per_pallet", usedPalletMaterial: packaging(3, "pallet", 10), ...fixed }],
    }
    jest.mocked(Variant.findOne).mockImplementation(async options => (options as any).attributes ? { id: 20, productId: 10 } as never : variant)
    jest.mocked(Juice.findOne).mockResolvedValue(juice)
    jest.mocked(Client.findOne).mockResolvedValue({ id: 9, isActive: true } as never)
    jest.mocked(loadJuiceRecipe).mockResolvedValue({ recipe: { rawMaterials: [{ rawMaterialId: 1, displayName: "Synthetic raw", percentage: 100, costPerLiter: 2 }], spices: [{ spiceMaterialId: 7, displayName: "Synthetic ingredient", gramsPerLiter: .5, costPerGram: 1 }] }, ingredientRows: [{ ingredientId: 7, gramsPerLiter: .5, ingredient: { id: 7, displayName: "Synthetic ingredient", costPerUnit: 453.592, costUnit: { unitCode: "pound", unitType: "weight", baseFactor: 453.592 } } }] } as never)
})

test("shared packaging, volume recipe and ingredients sum to an independent oracle without extra charges", async () => {
    const result = await calculateLinkedJuice(juice, input, "es")
    // 12 bottles: 24 raw + 6 ingredient + 1.2 bottles + 3 boxes + 20 pallets.
    expect(result).toMatchObject({ totalUnits: 12, rawMaterialCost: 24, ingredientCost: 6, unitPackagingCost: 1.2, intermediatePackagingCost: 3, palletMaterialCost: 20, totalCost: 54.2, processingCostTotal: 0, percentageCostTotal: 0, transportCost: 0, adjustmentCost: 0 })
    expect(result.breakdown.ingredients[0].gramsPerUnit).toBe(.5)
    expect(result.breakdown.production?.skuCode).toBe("SYN-JUICE")
    expect(quoteService.calculateQuote).not.toHaveBeenCalled()
    variant.sizePresentation.netWeightGrams = 450
    expect((await calculateLinkedJuice(juice, input, "es")).totalCost).toBe(54.2)
})
test("foreign material ids, inactive packaging and missing volume fail closed", async () => {
    await expect(calculateLinkedJuice(juice, { ...input, selectedUnitMaterialIds: [999] }, "es")).rejects.toMatchObject({ statusCode: 422 })
    variant.unitMaterials[0].usedUnitMaterial.isActive = false
    await expect(calculateLinkedJuice(juice, input, "es")).rejects.toMatchObject({ key: "errors.juice_invalid_packaging" })
    variant.sizePresentation.netVolumeMl = null
    await expect(calculateLinkedJuice(juice, input, "es")).rejects.toMatchObject({ key: "errors.juice_volume_required" })
})
test("legacy weight recipes and transport cannot enter the juice cost path", async () => {
    await expect(calculateLinkedJuice(juice, { ...input, destinationId: 5 }, "es")).rejects.toMatchObject({ key: "errors.juice_direct_costs_only" })
    variant.parentProduct.productRawMaterials = [{ id: 1 }]
    await expect(calculateLinkedJuice(juice, input, "es")).rejects.toMatchObject({ key: "errors.juice_volume_recipe_required" })
})
test("ordinary products delegate calculation and persistence to the original engine unchanged", async () => {
    jest.mocked(Juice.findOne).mockResolvedValue(null)
    jest.mocked(quoteService.calculateQuote).mockResolvedValue({ totalCost: 91 } as never)
    await expect(fixedQuoteService.calculateQuote(input, "es")).resolves.toEqual({ totalCost: 91 })
    expect(quoteService.calculateQuote).toHaveBeenCalledWith(input, "es")
    await fixedQuoteService.saveQuote(2, input, "es")
    expect(quoteService.saveQuote).toHaveBeenCalledWith(2, input, "es")
    expect(Quote.create).not.toHaveBeenCalled()
})
test("saving a juice stores the real ProductVariant and a complete standard quote/PDF snapshot", async () => {
    jest.mocked(Quote.create).mockResolvedValue({ id: 88, get: () => new Date(0) } as never)
    const order = { id: "72db466a-e594-48b7-9864-128b4b305b08", clientName: "Synthetic client" }
    const result = await fixedQuoteService.saveQuote(2, { ...input, order, draftKey: "bc03f33a-d9cf-46f5-9782-852b1caeb236" }, "es")
    expect(result).toMatchObject({ id: 88, productVariantId: 20, totalCost: 54.2, breakdown: { order } })
    expect(Quote.create).toHaveBeenCalledWith(expect.objectContaining({ salespersonId: 2, productVariantId: 20, rawMaterialCost: 24, ingredientCost: 6, breakdown: expect.objectContaining({ production: expect.objectContaining({ productId: 10 }), unitMaterials: expect.any(Array), palletMaterials: expect.any(Array) }) }))
    expect(quoteDraftService.markConverted).toHaveBeenCalledWith("bc03f33a-d9cf-46f5-9782-852b1caeb236", 2, 88)
})
test("incomplete recipes are excluded from the catalog, while configured juices retain their category and fixed recipe", async () => {
    const product = { id: 10, categoryId: 5, subCategoryId: 6, fixedRecipe: [], variants: [{ id: 20 }] }
    jest.mocked(quoteService.listQuotableProducts).mockResolvedValue([product] as never)
    jest.mocked(Variant.findAll).mockResolvedValue([variant])
    const record = { ...juice, mix: [{ rawMaterialId: 1, percentage: 99, rawMaterial: { isActive: true, displayName: "Synthetic raw" } }] }
    jest.mocked(Juice.findAll).mockResolvedValue([record] as never)
    expect(await fixedQuoteService.listQuotableProducts("es")).toEqual([])
    record.mix[0].percentage = 100
    expect(await fixedQuoteService.listQuotableProducts("es")).toEqual([expect.objectContaining({ categoryId: 5, subCategoryId: 6, fixedRecipe: [{ rawMaterialId: 1, percentage: 100, displayName: "Synthetic raw" }] })])
})

test("assigned ACME juice is retained in fixed products and assignment scope reaches the base catalog", async () => {
    jest.mocked(quoteService.listQuotableProducts).mockResolvedValue([{ id: 10, categoryId: 5, subCategoryId: 6, variants: [{ id: 20 }] }] as never)
    jest.mocked(Juice.findAll).mockResolvedValue([{ ...juice, mix: [{ rawMaterialId: 1, percentage: 100, rawMaterial: { isActive: true, displayName: "Carrot pineapple" } }] }] as never)
    jest.mocked(Variant.findAll).mockResolvedValue([variant])
    const result = await fixedQuoteService.listQuotableProducts("es", [11, 12])
    expect(quoteService.listQuotableProducts).toHaveBeenCalledWith("es", [11, 12])
    expect(result).toEqual([expect.objectContaining({ id: 10, categoryId: 5, subCategoryId: 6 })])
})
test("representative without clients receives no fixed products or juices", async () => {
    expect(await fixedQuoteService.listQuotableProducts("es", [])).toEqual([])
    expect(quoteService.listQuotableProducts).not.toHaveBeenCalled()
    expect(Juice.findAll).not.toHaveBeenCalled()
})
test("a juice SKU that uses the pallet kit adds it per pallet like any other product", async () => {
    const kitMaterial = (id: number, materialType: string, unitCost: string, quantity: string) => ({ id, code: `GEN-PAL-${id}`, displayName: materialType, materialType, unitCost, defaultQuantityBasis: "per_pallet", defaultQuantityValue: quantity })
    jest.mocked(loadPalletKit).mockResolvedValue([{ type: "TARIMA", options: [kitMaterial(901, "TARIMA", "10", "1.00")] }, { type: "ESQUINERO", options: [kitMaterial(902, "ESQUINERO", "2", "4.00")] }, { type: "STRETCH", options: [kitMaterial(903, "STRETCH", "0.05", "93.30")] }] as never)
    variant.usesPalletKit = true
    variant.palletMaterials = []
    const result = await calculateLinkedJuice(juice, input, "es")
    // 2 pallets: tarima 20 + esquineros 16 + stretch 9.33; the rest of the oracle stays 34.2.
    expect(result.palletMaterialCost).toBe(45.33)
    expect(result.totalCost).toBe(34.2 + 45.33)
})
