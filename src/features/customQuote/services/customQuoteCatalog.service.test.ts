import "reflect-metadata"

jest.mock("../models/CustomQuoteRawMaterialOption.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/CustomQuoteIngredientOption.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/CustomQuotePresentationOption.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/CustomQuotePackagingOption.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))

import CustomQuoteRawMaterialOption from "../models/CustomQuoteRawMaterialOption.model"
import CustomQuoteIngredientOption from "../models/CustomQuoteIngredientOption.model"
import CustomQuotePresentationOption from "../models/CustomQuotePresentationOption.model"
import CustomQuotePackagingOption from "../models/CustomQuotePackagingOption.model"
import { customQuoteCatalogService } from "./customQuoteCatalog.service"

function mocked(fn: unknown): jest.Mock {
    return fn as jest.Mock
}

const fruitCategory = { id: 1, displayName: "Frutas", imageUrl: "https://img/frutas.png", translations: [{ language: "en", displayName: "Fruits" }] }
const vegetableCategory = { id: 2, displayName: "Vegetales", imageUrl: null, translations: [] }
const fruitMixes = { id: 10, displayName: "Mezclas de fruta", translations: [{ language: "en", displayName: "Fruit mixes" }], parentCategory: fruitCategory }
const purees = { id: 11, displayName: "Purés", translations: [], parentCategory: fruitCategory }
const vegetableMixes = { id: 20, displayName: "Mezclas de vegetales", translations: [], parentCategory: vegetableCategory }

function rawMaterialOption(id: number, subCategory: object, rawMaterial: Record<string, unknown>, min: string | null = null, max: string | null = null) {
    return {
        id,
        rawMaterialId: rawMaterial.id,
        minPercentage: min,
        maxPercentage: max,
        subCategory,
        usedRawMaterial: { isOrganic: false, isMixable: true, ingredientType: "fruit", translations: [], ...rawMaterial },
    }
}

function packagingOption(id: number, role: string, optionGroup: string | null, isDefault = false) {
    return {
        id,
        packagingId: 100 + id,
        optionGroup,
        isDefault,
        packaging: { id: 100 + id, displayName: `MATERIAL ${id}`, unitCost: "0.2500", packagingRole: role },
    }
}

beforeEach(() => {
    mocked(CustomQuoteRawMaterialOption.findAll).mockResolvedValue([
        rawMaterialOption(1, fruitMixes, { id: 2, displayName: "Mango" }, "10.00", "60.00"),
        rawMaterialOption(2, fruitMixes, { id: 1, displayName: "Piña", translations: [{ language: "en", displayName: "Pineapple" }] }),
        rawMaterialOption(3, purees, { id: 1, displayName: "Piña" }),
        rawMaterialOption(4, vegetableMixes, { id: 5, displayName: "Zanahoria", ingredientType: "vegetable", isMixable: false }),
    ])
    mocked(CustomQuoteIngredientOption.findAll).mockResolvedValue([
        { ingredientId: 31, maxGramsPerKg: null, usedIngredient: { displayName: "Sal", translations: [{ language: "en", displayName: "Salt" }] } },
        { ingredientId: 30, maxGramsPerKg: "20.000", usedIngredient: { displayName: "Azúcar", translations: [] } },
    ])
    mocked(CustomQuotePresentationOption.findAll).mockResolvedValue([
        { presentationId: 8, boxesPerPallet: 20, bagsPerBox: 6, unitsPerIntermediatePackage: null, presentation: { displayLabel: "2 kg", netWeightGrams: "2000.00" } },
        { presentationId: 7, boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: 6, presentation: { displayLabel: "500 g", netWeightGrams: "500.00" } },
        { presentationId: 9, boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: null, presentation: { displayLabel: "Sin peso", netWeightGrams: null } },
    ])
    mocked(CustomQuotePackagingOption.findAll).mockResolvedValue([
        packagingOption(1, "unit", null),
        packagingOption(3, "unit", "Etiqueta"),
        packagingOption(2, "unit", "Etiqueta", true),
        packagingOption(4, "intermediate", null),
        packagingOption(5, "pallet", null),
        packagingOption(6, "pallet", "Film", true),
    ])
})

describe("customQuoteCatalogService.getCatalog", () => {
    it("solo lee filas activas cuyo elemento de catálogo (y su subcategoría/categoría) sigue activo", async () => {
        await customQuoteCatalogService.getCatalog()

        const rawMaterialQuery = mocked(CustomQuoteRawMaterialOption.findAll).mock.calls[0][0]
        expect(rawMaterialQuery.where).toEqual({ isActive: true })
        expect(rawMaterialQuery.include).toEqual([
            expect.objectContaining({ as: "usedRawMaterial", where: { isActive: true }, required: true }),
            expect.objectContaining({
                as: "subCategory",
                where: { isActive: true },
                required: true,
                include: expect.arrayContaining([expect.objectContaining({ as: "parentCategory", where: { isActive: true }, required: true })]),
            }),
        ])
        for (const model of [CustomQuoteIngredientOption, CustomQuotePresentationOption, CustomQuotePackagingOption]) {
            expect(mocked(model.findAll).mock.calls[0][0]).toMatchObject({
                where: { isActive: true },
                include: [expect.objectContaining({ where: { isActive: true }, required: true })],
            })
        }
    })

    it("arma categoría -> subcategoría -> materias primas, ordenado y con límites por defecto 0/100", async () => {
        const catalog = await customQuoteCatalogService.getCatalog("es")

        expect(catalog.categories).toEqual([
            {
                id: 1,
                displayName: "Frutas",
                imageUrl: "https://img/frutas.png",
                subCategories: [
                    {
                        id: 10,
                        displayName: "Mezclas de fruta",
                        rawMaterials: [
                            { rawMaterialId: 2, displayName: "Mango", isOrganic: false, isMixable: true, ingredientType: "fruit", minPercentage: 10, maxPercentage: 60 },
                            { rawMaterialId: 1, displayName: "Piña", isOrganic: false, isMixable: true, ingredientType: "fruit", minPercentage: 0, maxPercentage: 100 },
                        ],
                    },
                    {
                        id: 11,
                        displayName: "Purés",
                        rawMaterials: [expect.objectContaining({ rawMaterialId: 1 })],
                    },
                ],
            },
            {
                id: 2,
                displayName: "Vegetales",
                imageUrl: null,
                subCategories: [
                    { id: 20, displayName: "Mezclas de vegetales", rawMaterials: [expect.objectContaining({ rawMaterialId: 5, isMixable: false, ingredientType: "vegetable" })] },
                ],
            },
        ])
    })

    it("traduce categorías, subcategorías, materias primas e ingredientes", async () => {
        const catalog = await customQuoteCatalogService.getCatalog("en")

        expect(catalog.categories[0].displayName).toBe("Fruits")
        expect(catalog.categories[0].subCategories[0].displayName).toBe("Fruit mixes")
        expect(catalog.categories[0].subCategories[0].rawMaterials.map(rawMaterial => rawMaterial.displayName)).toEqual(["Mango", "Pineapple"])
        expect(catalog.ingredients.map(ingredient => ingredient.displayName)).toEqual(["Azúcar", "Salt"])
    })

    it("ingredientes con el tope casteado a número", async () => {
        const catalog = await customQuoteCatalogService.getCatalog("es")

        expect(catalog.ingredients).toEqual([
            { ingredientId: 30, displayName: "Azúcar", maxGramsPerKg: 20 },
            { ingredientId: 31, displayName: "Sal", maxGramsPerKg: null },
        ])
    })

    it("presentaciones por peso, con sus cuentas de palet, sin las que no tienen peso neto", async () => {
        const catalog = await customQuoteCatalogService.getCatalog()

        expect(catalog.presentations).toEqual([
            { presentationId: 7, displayLabel: "500 g", netWeightGrams: 500, boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: 6 },
            { presentationId: 8, displayLabel: "2 kg", netWeightGrams: 2000, boxesPerPallet: 20, bagsPerBox: 6, unitsPerIntermediatePackage: null },
        ])
    })

    it("empaques por nivel: fijas aparte y grupos con sus alternativas (ids de fila), como en el motor", async () => {
        const catalog = await customQuoteCatalogService.getCatalog()

        expect(catalog.packaging.unit).toEqual({
            fixed: [{ id: 1, packagingId: 101, displayName: "MATERIAL 1" }],
            groups: [{
                group: "Etiqueta",
                options: [
                    { id: 2, packagingId: 102, displayName: "MATERIAL 2", unitCost: 0.25, isDefault: true },
                    { id: 3, packagingId: 103, displayName: "MATERIAL 3", unitCost: 0.25, isDefault: false },
                ],
            }],
        })
        expect(catalog.packaging.intermediate).toEqual({ fixed: [{ id: 4, packagingId: 104, displayName: "MATERIAL 4" }], groups: [] })
        expect(catalog.packaging.pallet.groups).toEqual([expect.objectContaining({ group: "Film" })])
    })
})
