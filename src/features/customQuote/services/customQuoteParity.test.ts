import "reflect-metadata"

// PRUEBA DE PARIDAD: una cotización a la medida configurada exactamente igual que un SKU existente
// (misma presentación y cuentas de palet, mismos %, mismos gramos de ingrediente, mismos materiales y
// cantidades, misma elección por grupo) debe dar las MISMAS líneas y el MISMO total que calculateQuote
// para ese SKU. Es la prueba de que el motor a la medida reutiliza la matemática de productos
// definidos en vez de tener una propia. Ambos motores leen el mismo catálogo simulado.

// ---- Productos definidos ----
jest.mock("../../product/models/ProductVariant.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
jest.mock("../../quoteDraft/services/quoteDraft.service", () => ({
    quoteDraftService: { upsertFromCalculation: jest.fn(), markConverted: jest.fn(), listDrafts: jest.fn() }
}))
// ---- A la medida ----
jest.mock("../models/CustomQuotePresentationOption.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../models/CustomQuoteRawMaterialOption.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/CustomQuoteIngredientOption.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/CustomQuotePackagingOption.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../category/models/SubCategory.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
// ---- Compartidos ----
jest.mock("../../destination/models/Destination.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../processingCost/models/ProcessingCost.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))

import ProductVariant from "../../product/models/ProductVariant.model"
import CustomQuotePresentationOption from "../models/CustomQuotePresentationOption.model"
import CustomQuoteRawMaterialOption from "../models/CustomQuoteRawMaterialOption.model"
import CustomQuoteIngredientOption from "../models/CustomQuoteIngredientOption.model"
import CustomQuotePackagingOption from "../models/CustomQuotePackagingOption.model"
import SubCategory from "../../category/models/SubCategory.model"
import Destination from "../../destination/models/Destination.model"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import { quoteService } from "../../quote/services/quote.service"
import { customQuoteService } from "./customQuote.service"

function mocked(fn: unknown): jest.Mock {
    return fn as jest.Mock
}

// ---- Catálogo compartido ----
const POUND = { unitType: "weight", baseFactor: 453.592 }
const pineapple = {
    id: 1, displayName: "Piña", costPerUnit: "0.8500", costUnit: POUND, isMixable: true, isOrganic: false, ingredientType: "fruit",
    translations: [{ language: "en", displayName: "Pineapple" }]
}
const mango = {
    id: 2, displayName: "Mango", costPerUnit: "1.1000", costUnit: POUND, isMixable: true, isOrganic: false, ingredientType: "fruit",
    translations: []
}
const salt = { id: 30, displayName: "Sal", costPerUnit: "0.5000", costUnit: POUND, translations: [{ language: "en", displayName: "Salt" }] }
const bag = { id: 100, displayName: "BOLSA 500G", unitCost: "0.0500", packagingRole: "unit" }
const labelA = { id: 101, displayName: "ETIQUETA A", unitCost: "0.0100", packagingRole: "unit" }
const labelB = { id: 102, displayName: "ETIQUETA B", unitCost: "0.0200", packagingRole: "unit" }
const masterBag = { id: 110, displayName: "BOLSA MASTER", unitCost: "0.3000", packagingRole: "intermediate" }
const box = { id: 120, displayName: "CAJA", unitCost: "0.9000", packagingRole: "pallet" }
const filmA = { id: 121, displayName: "FILM A", unitCost: "4.0000", packagingRole: "pallet" }
const filmB = { id: 122, displayName: "FILM B", unitCost: "5.5000", packagingRole: "pallet" }
const presentation = { id: 7, displayLabel: "500 g", netWeightGrams: "500.00", isActive: true }
const destination = { id: 9, displayName: "Puerto Quetzal", baseCost: "150.00" }
const PROCESSING_COSTS = [
    { id: 1, displayName: "Energía", value: "0.1000", calculationType: "per_weight", translations: [] },
    { id: 2, displayName: "Administración", value: "5.00", calculationType: "percentage", translations: [] },
]

type Scenario = {
    name: string
    language: "es" | "en"
    withIntermediate: boolean
    rawMaterialMix: { rawMaterialId: number; percentage: number }[]
    saltGramsPerUnit: number | null
    selectedUnitIds?: number[]
    selectedPalletIds?: number[]
    destinationId?: number
    requestedPallets: number
}

// SKU de productos definidos con la configuración del escenario.
function definedVariant(scenario: Scenario) {
    return {
        id: 50,
        boxesPerPallet: 40,
        bagsPerBox: 12,
        unitsPerIntermediatePackage: scenario.withIntermediate ? 6 : null,
        sizePresentation: presentation,
        parentProduct: {
            id: 5,
            displayName: "Mezcla tropical",
            translations: [],
            isCustomizable: true,
            additionalCostPerUnit: null,
            productRawMaterials: [
                { rawMaterialId: 1, minPercentage: null, maxPercentage: null, usedRawMaterial: pineapple },
                { rawMaterialId: 2, minPercentage: null, maxPercentage: null, usedRawMaterial: mango },
            ],
            productIngredients: scenario.saltGramsPerUnit === null
                ? []
                : [{ id: 1, ingredientId: 30, grams: String(scenario.saltGramsPerUnit), referenceNetWeightGrams: "500.00", usedIngredient: salt }],
        },
        unitMaterials: [
            { id: 1, packagingId: 100, quantityPerUnit: "1.00", optionGroup: null, isDefault: false, usedUnitMaterial: bag },
            { id: 2, packagingId: 101, quantityPerUnit: "1.00", optionGroup: "Etiqueta", isDefault: true, usedUnitMaterial: labelA },
            { id: 3, packagingId: 102, quantityPerUnit: "1.00", optionGroup: "Etiqueta", isDefault: false, usedUnitMaterial: labelB },
        ],
        intermediateMaterials: scenario.withIntermediate
            ? [{ id: 4, packagingId: 110, optionGroup: null, isDefault: false, usedIntermediateMaterial: masterBag }]
            : [],
        palletMaterials: [
            { id: 5, packagingId: 120, quantityValue: "40.00", optionGroup: null, isDefault: false, usedPalletMaterial: box },
            { id: 6, packagingId: 121, quantityValue: "2.00", optionGroup: "Film", isDefault: true, usedPalletMaterial: filmA },
            { id: 7, packagingId: 122, quantityValue: "2.00", optionGroup: "Film", isDefault: false, usedPalletMaterial: filmB },
        ],
    }
}

// Las mismas decisiones cargadas como listas de permitidos. Los ids de fila coinciden con los del SKU
// para que la elección por grupo (y el orden estable por id) sea la misma. La caja va "por caja" (1 ×
// 40 cajas por palet = los 40 del SKU); el nivel intermedio de la lista existe siempre, pero solo se
// costea si la presentación ofrecida lo tiene.
function allowedLists(scenario: Scenario) {
    mocked(CustomQuotePresentationOption.findOne).mockResolvedValue({
        id: 1, presentationId: 7, boxesPerPallet: 40, bagsPerBox: 12,
        unitsPerIntermediatePackage: scenario.withIntermediate ? 6 : null, presentation
    })
    mocked(CustomQuoteRawMaterialOption.findAll).mockResolvedValue([
        { id: 1, subCategoryId: 3, rawMaterialId: 1, minPercentage: null, maxPercentage: null, usedRawMaterial: pineapple },
        { id: 2, subCategoryId: 3, rawMaterialId: 2, minPercentage: null, maxPercentage: null, usedRawMaterial: mango },
    ])
    mocked(CustomQuoteIngredientOption.findAll).mockResolvedValue([{ id: 1, ingredientId: 30, maxGramsPerKg: null, usedIngredient: salt }])
    mocked(CustomQuotePackagingOption.findAll).mockResolvedValue([
        { id: 1, packagingId: 100, quantity: "1.00", quantityBasis: "per_unit", optionGroup: null, isDefault: false, packaging: bag },
        { id: 2, packagingId: 101, quantity: "1.00", quantityBasis: "per_unit", optionGroup: "Etiqueta", isDefault: true, packaging: labelA },
        { id: 3, packagingId: 102, quantity: "1.00", quantityBasis: "per_unit", optionGroup: "Etiqueta", isDefault: false, packaging: labelB },
        { id: 4, packagingId: 110, quantity: null, quantityBasis: null, optionGroup: null, isDefault: false, packaging: masterBag },
        { id: 5, packagingId: 120, quantity: "1.00", quantityBasis: "per_box", optionGroup: null, isDefault: false, packaging: box },
        { id: 6, packagingId: 121, quantity: "2.00", quantityBasis: "per_pallet", optionGroup: "Film", isDefault: true, packaging: filmA },
        { id: 7, packagingId: 122, quantity: "2.00", quantityBasis: "per_pallet", optionGroup: "Film", isDefault: false, packaging: filmB },
    ])
}

const SCENARIOS: Scenario[] = [
    {
        name: "mezcla 60/40 + sal + intermedio + elección en dos grupos + destino, en inglés",
        language: "en",
        withIntermediate: true,
        rawMaterialMix: [{ rawMaterialId: 1, percentage: 60 }, { rawMaterialId: 2, percentage: 40 }],
        saltGramsPerUnit: 10,
        selectedUnitIds: [3],
        selectedPalletIds: [7],
        destinationId: 9,
        requestedPallets: 3,
    },
    {
        name: "una sola materia prima al 100%, defaults de cada grupo, sin intermedio, sin ingredientes ni destino",
        language: "es",
        withIntermediate: false,
        rawMaterialMix: [{ rawMaterialId: 2, percentage: 100 }],
        saltGramsPerUnit: null,
        requestedPallets: 1,
    },
    {
        name: "mezcla con decimales (33.33 / 66.67) y 20 palets",
        language: "es",
        withIntermediate: true,
        rawMaterialMix: [{ rawMaterialId: 1, percentage: 33.33 }, { rawMaterialId: 2, percentage: 66.67 }],
        saltGramsPerUnit: 7.5,
        requestedPallets: 20,
    },
]

const MONEY_FIELDS = [
    "rawMaterialCost",
    "ingredientCost",
    "unitPackagingCost",
    "intermediatePackagingCost",
    "processingCostTotal",
    "palletMaterialCost",
    "percentageCostTotal",
    "transportCost",
    "adjustmentCost",
    "totalCost",
] as const

describe("paridad: cotización a la medida == calculateQuote del SKU equivalente", () => {
    beforeEach(() => {
        mocked(ProcessingCost.findAll).mockResolvedValue(PROCESSING_COSTS)
        mocked(Destination.findOne).mockResolvedValue(destination)
        mocked(SubCategory.findOne).mockResolvedValue({ id: 3 })
    })

    it.each(SCENARIOS)("$name", async (scenario) => {
        mocked(ProductVariant.findOne).mockResolvedValue(definedVariant(scenario))
        allowedLists(scenario)

        const defined = await quoteService.calculateQuote(
            {
                productVariantId: 50,
                requestedPallets: scenario.requestedPallets,
                destinationId: scenario.destinationId,
                rawMaterialMix: scenario.rawMaterialMix,
                selectedUnitMaterialIds: scenario.selectedUnitIds,
                selectedPalletMaterialIds: scenario.selectedPalletIds,
            },
            scenario.language
        )
        const custom = await customQuoteService.calculateCustomQuote(
            {
                subCategoryId: 3,
                presentationId: 7,
                rawMaterialMix: scenario.rawMaterialMix,
                ingredients: scenario.saltGramsPerUnit === null ? [] : [{ ingredientId: 30, gramsPerUnit: scenario.saltGramsPerUnit }],
                selectedUnitPackagingOptionIds: scenario.selectedUnitIds,
                selectedPalletPackagingOptionIds: scenario.selectedPalletIds,
                isOrganic: false,
                requestedPallets: scenario.requestedPallets,
                destinationId: scenario.destinationId,
            },
            scenario.language
        )

        // Las líneas: el breakdown completo, línea por línea (incluye transporte, ajuste e idioma).
        expect(custom.breakdown).toEqual(defined.breakdown)
        // Los totales por concepto y el total.
        for (const field of MONEY_FIELDS) {
            expect(custom[field]).toBe(defined[field])
        }
        expect(custom.totalUnits).toBe(defined.totalUnits)
        expect(custom.boxesPerPallet).toBe(defined.boxesPerPallet)
        expect(custom.destinationId).toBe(defined.destinationId)
        expect(custom.variantLabel).toBe(defined.variantLabel)

        // La paridad no es trivial: el escenario ejercita cada tipo de línea que declara.
        expect(defined.totalCost).toBeGreaterThan(0)
        expect(defined.breakdown.rawMaterials).toHaveLength(scenario.rawMaterialMix.length)
        expect(defined.breakdown.intermediateMaterials).toHaveLength(scenario.withIntermediate ? 1 : 0)
        expect(defined.breakdown.ingredients).toHaveLength(scenario.saltGramsPerUnit === null ? 0 : 1)
        expect(defined.breakdown.processingCosts).toHaveLength(1)
        expect(defined.breakdown.percentageCosts).toHaveLength(1)
    })

    it("la elección por grupo cambia el total igual en los dos motores", async () => {
        const scenario = SCENARIOS[0]
        mocked(ProductVariant.findOne).mockResolvedValue(definedVariant(scenario))
        allowedLists(scenario)

        const definedDefaults = await quoteService.calculateQuote({
            productVariantId: 50, requestedPallets: 3, rawMaterialMix: scenario.rawMaterialMix
        })
        const customDefaults = await customQuoteService.calculateCustomQuote({
            subCategoryId: 3, presentationId: 7, rawMaterialMix: scenario.rawMaterialMix,
            ingredients: [{ ingredientId: 30, gramsPerUnit: 10 }], isOrganic: false, requestedPallets: 3
        })
        const customSelected = await customQuoteService.calculateCustomQuote({
            subCategoryId: 3, presentationId: 7, rawMaterialMix: scenario.rawMaterialMix,
            ingredients: [{ ingredientId: 30, gramsPerUnit: 10 }], isOrganic: false, requestedPallets: 3,
            selectedUnitPackagingOptionIds: [3], selectedPalletPackagingOptionIds: [7]
        })

        expect(customDefaults.totalCost).toBe(definedDefaults.totalCost)
        expect(customSelected.totalCost).toBeGreaterThan(customDefaults.totalCost)
    })
})
