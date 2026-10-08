import "reflect-metadata"

// Validación y armado del motor a la medida (la matemática por línea se prueba por paridad con
// calculateQuote en customQuoteParity.test.ts). Los modelos exponen también create/update para
// poder afirmar que el motor nunca escribe.
jest.mock("../models/CustomQuotePresentationOption.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() } }))
jest.mock("../models/CustomQuoteRawMaterialOption.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() } }))
jest.mock("../models/CustomQuoteIngredientOption.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() } }))
jest.mock("../models/CustomQuotePackagingOption.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() } }))
jest.mock("../models/CustomQuote.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../../category/models/SubCategory.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../destination/models/Destination.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../processingCost/models/ProcessingCost.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))

import CustomQuotePresentationOption from "../models/CustomQuotePresentationOption.model"
import CustomQuoteRawMaterialOption from "../models/CustomQuoteRawMaterialOption.model"
import CustomQuoteIngredientOption from "../models/CustomQuoteIngredientOption.model"
import CustomQuotePackagingOption from "../models/CustomQuotePackagingOption.model"
import CustomQuote from "../models/CustomQuote.model"
import SubCategory from "../../category/models/SubCategory.model"
import Destination from "../../destination/models/Destination.model"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import { customQuoteService } from "./customQuote.service"
import type { CustomQuoteCalculationInput } from "../schemas/customQuote.schema"

function mocked(fn: unknown): jest.Mock {
    return fn as jest.Mock
}

const POUND = { unitType: "weight", baseFactor: 453.592 }

function rawMaterial(id: number, displayName: string, overrides: Record<string, unknown> = {}) {
    return { id, displayName, costPerUnit: "1.0000", costUnit: POUND, isMixable: true, isOrganic: false, ingredientType: "fruit", translations: [], ...overrides }
}

function packagingOption(id: number, role: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        packagingId: 100 + id,
        quantity: role === "intermediate" ? null : "1.00",
        quantityBasis: role === "unit" ? "per_unit" : role === "pallet" ? "per_pallet" : null,
        optionGroup: null,
        isDefault: false,
        packaging: { id: 100 + id, displayName: `MATERIAL ${id}`, unitCost: "0.5000", packagingRole: role },
        ...overrides,
    }
}

const presentation = { id: 7, displayLabel: "500 g", netWeightGrams: "500.00" }

function presentationOption(overrides: Record<string, unknown> = {}) {
    return { id: 1, presentationId: 7, boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: 6, presentation, ...overrides }
}

const BASE_INPUT: CustomQuoteCalculationInput = {
    subCategoryId: 3,
    presentationId: 7,
    rawMaterialMix: [{ rawMaterialId: 1, percentage: 60 }, { rawMaterialId: 2, percentage: 40 }],
    ingredients: [],
    isOrganic: false,
    requestedPallets: 2,
}

function calculate(overrides: Partial<CustomQuoteCalculationInput> = {}, language: "es" | "en" = "es") {
    return customQuoteService.calculateCustomQuote({ ...BASE_INPUT, ...overrides }, language)
}

beforeEach(() => {
    mocked(CustomQuotePresentationOption.findOne).mockResolvedValue(presentationOption())
    mocked(SubCategory.findOne).mockResolvedValue({ id: 3 })
    mocked(CustomQuoteRawMaterialOption.findAll).mockResolvedValue([
        { id: 1, rawMaterialId: 1, minPercentage: null, maxPercentage: null, usedRawMaterial: rawMaterial(1, "Piña", { translations: [{ language: "en", displayName: "Pineapple" }] }) },
        { id: 2, rawMaterialId: 2, minPercentage: "10.00", maxPercentage: "50.00", usedRawMaterial: rawMaterial(2, "Mango") },
        { id: 3, rawMaterialId: 3, minPercentage: null, maxPercentage: null, usedRawMaterial: rawMaterial(3, "Cobertura", { isMixable: false }) },
        { id: 4, rawMaterialId: 4, minPercentage: null, maxPercentage: null, usedRawMaterial: rawMaterial(4, "Fresa orgánica", { isOrganic: true }) },
        { id: 5, rawMaterialId: 5, minPercentage: null, maxPercentage: null, usedRawMaterial: rawMaterial(5, "Agua", { ingredientType: "other" }) },
    ])
    mocked(CustomQuoteIngredientOption.findAll).mockResolvedValue([
        { id: 1, ingredientId: 30, maxGramsPerKg: "20.000", usedIngredient: { id: 30, displayName: "Sal", costPerUnit: "0.5000", costUnit: POUND, translations: [] } },
        { id: 2, ingredientId: 31, maxGramsPerKg: null, usedIngredient: { id: 31, displayName: "Azúcar", costPerUnit: "0.7000", costUnit: POUND, translations: [] } },
    ])
    mocked(CustomQuotePackagingOption.findAll).mockResolvedValue([
        packagingOption(1, "unit"),
        packagingOption(2, "unit", { optionGroup: "Etiqueta", isDefault: true }),
        packagingOption(3, "unit", { optionGroup: "Etiqueta" }),
        packagingOption(4, "intermediate"),
        packagingOption(5, "pallet", { quantityBasis: "per_box" }),
        packagingOption(6, "pallet", { quantity: "2.00" }),
    ])
    mocked(ProcessingCost.findAll).mockResolvedValue([])
    mocked(Destination.findOne).mockResolvedValue({ id: 9, displayName: "Puerto", baseCost: "150.00" })
})

describe("customQuoteService.calculateCustomQuote -- carga", () => {
    it("pide solo filas activas cuyo elemento de catálogo sigue activo", async () => {
        await calculate()

        expect(mocked(CustomQuotePresentationOption.findOne).mock.calls[0][0]).toMatchObject({
            where: { presentationId: 7, isActive: true },
            include: [expect.objectContaining({ where: { isActive: true }, required: true })],
        })
        expect(SubCategory.findOne).toHaveBeenCalledWith({ where: { id: 3, isActive: true } })
        expect(mocked(CustomQuoteRawMaterialOption.findAll).mock.calls[0][0]).toMatchObject({
            where: { subCategoryId: 3, isActive: true },
            include: [expect.objectContaining({ as: "usedRawMaterial", where: { isActive: true }, required: true })],
        })
        expect(mocked(CustomQuotePackagingOption.findAll).mock.calls[0][0]).toMatchObject({
            where: { isActive: true },
            include: [expect.objectContaining({ as: "packaging", where: { isActive: true }, required: true })],
        })
    })

    it("sin ingredientes no consulta la lista de ingredientes", async () => {
        await calculate()
        expect(CustomQuoteIngredientOption.findAll).not.toHaveBeenCalled()
    })

    it("nunca escribe en ninguna tabla", async () => {
        await calculate({ ingredients: [{ ingredientId: 31, gramsPerUnit: 5 }], destinationId: 9 })

        for (const model of [CustomQuotePresentationOption, CustomQuoteRawMaterialOption, CustomQuoteIngredientOption, CustomQuotePackagingOption]) {
            expect(model.create).not.toHaveBeenCalled()
            expect(model.update).not.toHaveBeenCalled()
        }
    })

    it("presentación no ofrecida (o inactiva) -> 422", async () => {
        mocked(CustomQuotePresentationOption.findOne).mockResolvedValue(null)

        await expect(calculate()).rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_presentation_not_offered" })
    })

    it("subcategoría inexistente o inactiva -> 404", async () => {
        mocked(SubCategory.findOne).mockResolvedValue(null)

        await expect(calculate()).rejects.toMatchObject({ statusCode: 404, params: { resource: "SubCategory", id: 3 } })
    })

    it("destino inexistente -> 404; sin destino el transporte es 0", async () => {
        mocked(Destination.findOne).mockResolvedValue(null)
        await expect(calculate({ destinationId: 99 })).rejects.toMatchObject({ statusCode: 404 })

        const result = await calculate()
        expect(result.transportCost).toBe(0)
        expect(result.destinationId).toBeNull()
    })
})

describe("receta", () => {
    it("materia prima fuera de la lista de la subcategoría -> 422 propio de este flujo", async () => {
        await expect(calculate({ rawMaterialMix: [{ rawMaterialId: 99, percentage: 100 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_raw_material_not_offered", params: { rawMaterialId: 99 } })
    })

    it("una materia prima no mezclable dentro de una mezcla -> 422 con su nombre", async () => {
        await expect(calculate({ rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 3, percentage: 50 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_raw_material_not_mixable", params: { rawMaterial: "Cobertura" } })
    })

    it("una materia prima no mezclable sola al 100% se permite", async () => {
        const result = await calculate({ rawMaterialMix: [{ rawMaterialId: 3, percentage: 100 }] })
        expect(result.breakdown.rawMaterials).toHaveLength(1)
    })

    it("orgánico: una convencional se rechaza; orgánica e insumo 'other' se permiten", async () => {
        await expect(calculate({ isOrganic: true, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_raw_material_not_organic_compatible", params: { rawMaterial: "Piña" } })

        const result = await calculate({
            isOrganic: true,
            rawMaterialMix: [{ rawMaterialId: 4, percentage: 90 }, { rawMaterialId: 5, percentage: 10 }],
        })
        expect(result.isOrganic).toBe(true)
    })

    it("los límites de la lista se aplican (mango entre 10% y 50%)", async () => {
        await expect(calculate({ rawMaterialMix: [{ rawMaterialId: 1, percentage: 40 }, { rawMaterialId: 2, percentage: 60 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.raw_material_percentage_out_of_range" })
    })

    it("la mezcla debe sumar 100", async () => {
        await expect(calculate({ rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 2, percentage: 40 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.mix_percentage_must_total_100" })
    })

    it("la misma materia prima dos veces -> 422", async () => {
        await expect(calculate({ rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 1, percentage: 50 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.duplicate_raw_material_in_mix" })
    })
})

describe("ingredientes", () => {
    it("ingrediente fuera de la lista -> 422", async () => {
        await expect(calculate({ ingredients: [{ ingredientId: 77, gramsPerUnit: 5 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_ingredient_not_offered" })
    })

    it("el mismo ingrediente dos veces -> 422", async () => {
        await expect(calculate({ ingredients: [{ ingredientId: 31, gramsPerUnit: 5 }, { ingredientId: 31, gramsPerUnit: 5 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_duplicate_ingredient" })
    })

    it("más gramos que el peso neto -> 422", async () => {
        await expect(calculate({ ingredients: [{ ingredientId: 31, gramsPerUnit: 600 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_ingredient_exceeds_net_weight", params: { netWeightGrams: 500 } })
    })

    it("tope por kg: 10 g en 500 g (= 20 g/kg) entra justo; 10.5 g (= 21 g/kg) no", async () => {
        const ok = await calculate({ ingredients: [{ ingredientId: 30, gramsPerUnit: 10 }] })
        expect(ok.breakdown.ingredients[0]).toMatchObject({ ingredientId: 30, grams: 10, referenceNetWeightGrams: 500, gramsPerUnit: 10 })

        await expect(calculate({ ingredients: [{ ingredientId: 30, gramsPerUnit: 10.5 }] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_ingredient_exceeds_cap", params: { ingredient: "Sal", maxGramsPerKg: 20 } })
    })
})

describe("empaques", () => {
    it("fijas + default de cada grupo; por caja se multiplica por las cajas por palet", async () => {
        const result = await calculate()

        expect(result.breakdown.unitMaterials.map(line => line.packagingId)).toEqual([101, 102])
        expect(result.breakdown.palletMaterials).toEqual([
            expect.objectContaining({ packagingId: 105, quantityPerPallet: 40 }),
            expect.objectContaining({ packagingId: 106, quantityPerPallet: 2 }),
        ])
        expect(result.breakdown.intermediateMaterials).toEqual([expect.objectContaining({ packagingId: 104, unitsPerPackage: 6 })])
    })

    it("la elección del representante reemplaza el default de su grupo", async () => {
        const result = await calculate({ selectedUnitPackagingOptionIds: [3] })
        expect(result.breakdown.unitMaterials.map(line => line.packagingId)).toEqual([101, 103])
    })

    it("un id que no es una alternativa del nivel (fila fija u otro nivel) -> 422", async () => {
        await expect(calculate({ selectedUnitPackagingOptionIds: [1] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.invalid_unit_material_selection" })
        await expect(calculate({ selectedUnitPackagingOptionIds: [6] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.invalid_unit_material_selection" })
    })

    it("presentación sin nivel intermedio: no se costea ninguna fila intermedia, y elegir una -> 422", async () => {
        mocked(CustomQuotePresentationOption.findOne).mockResolvedValue(presentationOption({ unitsPerIntermediatePackage: null }))

        const result = await calculate()
        expect(result.breakdown.intermediateMaterials).toEqual([])
        expect(result.intermediatePackagingCost).toBe(0)

        await expect(calculate({ selectedIntermediatePackagingOptionIds: [4] }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_presentation_has_no_intermediate" })
    })

    it("sin empaque individual o sin paletización configurados -> 422", async () => {
        mocked(CustomQuotePackagingOption.findAll).mockResolvedValue([packagingOption(5, "pallet")])
        await expect(calculate()).rejects.toMatchObject({ key: "errors.custom_quote_unit_packaging_not_configured" })

        mocked(CustomQuotePackagingOption.findAll).mockResolvedValue([packagingOption(1, "unit")])
        await expect(calculate()).rejects.toMatchObject({ key: "errors.custom_quote_pallet_packaging_not_configured" })
    })

    it("una fila sin cantidad (dato corrupto) no se costea en $0 en silencio -> 422", async () => {
        mocked(CustomQuotePackagingOption.findAll).mockResolvedValue([
            packagingOption(1, "unit", { quantity: null }),
            packagingOption(5, "pallet"),
        ])
        await expect(calculate()).rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_packaging_quantity_missing" })
    })
})

describe("resultado", () => {
    it("unidades = palets × cajas × bolsas; sin ajuste manual", async () => {
        const result = await calculate({ requestedPallets: 3 })

        expect(result.totalUnits).toBe(3 * 40 * 12)
        expect(result.adjustmentCost).toBe(0)
        expect(result.breakdown.adjustment).toBeNull()
    })

    it("nombre y etiqueta generados, en el idioma pedido", async () => {
        const es = await calculate()
        expect(es.productDisplayName).toBe("A la medida · 60% Piña · 40% Mango")
        expect(es.variantLabel).toBe("12 und × 500 g · 40 cajas/palet")

        const en = await calculate({}, "en")
        expect(en.productDisplayName).toBe("Custom · 60% Pineapple · 40% Mango")
        expect(en.variantLabel).toBe("12 units × 500 g · 40 boxes/pallet")
    })

    it("la configuración guarda lo elegido y las cantidades resueltas por nivel", async () => {
        const result = await calculate({ ingredients: [{ ingredientId: 31, gramsPerUnit: 5 }], selectedUnitPackagingOptionIds: [3], destinationId: 9 })

        expect(result.configuration).toEqual({
            subCategoryId: 3,
            presentationId: 7,
            isOrganic: false,
            requestedPallets: 2,
            destinationId: 9,
            rawMaterialMix: BASE_INPUT.rawMaterialMix,
            ingredients: [{ ingredientId: 31, gramsPerUnit: 5 }],
            pallet: { boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: 6 },
            packaging: {
                unit: [
                    { packagingOptionId: 1, packagingId: 101, optionGroup: null, quantity: 1, quantityBasis: "per_unit" },
                    { packagingOptionId: 3, packagingId: 103, optionGroup: "Etiqueta", quantity: 1, quantityBasis: "per_unit" },
                ],
                intermediate: [{ packagingOptionId: 4, packagingId: 104, optionGroup: null, quantity: null, quantityBasis: null }],
                pallet: [
                    { packagingOptionId: 5, packagingId: 105, optionGroup: null, quantity: 1, quantityBasis: "per_box" },
                    { packagingOptionId: 6, packagingId: 106, optionGroup: null, quantity: 2, quantityBasis: "per_pallet" },
                ],
            },
        })
    })
})

describe("customQuoteService.saveCustomQuote", () => {
    beforeEach(() => {
        mocked(CustomQuote.create).mockImplementation(async (values: Record<string, unknown>) => ({
            id: 77,
            status: values.status,
            get: (key: string) => (key === "createdAt" ? new Date("2026-09-29T15:00:00.000Z") : undefined),
        }))
    })

    const SAVE_INPUT: CustomQuoteCalculationInput = {
        ...BASE_INPUT,
        ingredients: [{ ingredientId: 31, gramsPerUnit: 5 }],
        selectedUnitPackagingOptionIds: [3],
        destinationId: 9,
    }

    it("recalcula en el servidor y guarda exactamente ese resultado, a nombre del representante", async () => {
        const calculation = await customQuoteService.calculateCustomQuote(SAVE_INPUT, "es")

        await customQuoteService.saveCustomQuote(42, SAVE_INPUT, "es")

        expect(CustomQuote.create).toHaveBeenCalledTimes(1)
        expect(CustomQuote.create).toHaveBeenCalledWith({
            salespersonId: 42,
            subCategoryId: 3,
            presentationId: 7,
            destinationId: 9,
            productDisplayName: calculation.productDisplayName,
            variantLabel: calculation.variantLabel,
            isOrganic: false,
            requestedPallets: 2,
            totalUnits: calculation.totalUnits,
            boxesPerPallet: 40,
            bagsPerBox: 12,
            unitsPerIntermediatePackage: 6,
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
    })

    it("no guarda ningún vínculo a un Cliente ni a un SKU", async () => {
        await customQuoteService.saveCustomQuote(42, SAVE_INPUT)

        const payload = mocked(CustomQuote.create).mock.calls[0][0]
        expect(payload).not.toHaveProperty("clientId")
        expect(payload).not.toHaveProperty("productVariantId")
        expect(payload).not.toHaveProperty("productId")
    })

    it("devuelve el cálculo + id, estado y fecha de la fila guardada", async () => {
        const result = await customQuoteService.saveCustomQuote(42, SAVE_INPUT)

        expect(result).toMatchObject({ id: 77, status: "new", createdAt: new Date("2026-09-29T15:00:00.000Z"), subCategoryId: 3 })
        expect(result.breakdown.ingredients).toHaveLength(1)
    })

    it("si el cálculo falla no se guarda nada", async () => {
        mocked(CustomQuotePresentationOption.findOne).mockResolvedValue(null)

        await expect(customQuoteService.saveCustomQuote(42, SAVE_INPUT)).rejects.toMatchObject({ statusCode: 422 })
        expect(CustomQuote.create).not.toHaveBeenCalled()
    })

    it("solo escribe en customQuotes (las listas de permitidos no se tocan)", async () => {
        await customQuoteService.saveCustomQuote(42, SAVE_INPUT)

        for (const model of [CustomQuotePresentationOption, CustomQuoteRawMaterialOption, CustomQuoteIngredientOption, CustomQuotePackagingOption]) {
            expect(model.create).not.toHaveBeenCalled()
            expect(model.update).not.toHaveBeenCalled()
        }
    })
})
