import "reflect-metadata"

// Las tres listas "simples" de cotizaciones a la medida: materias primas por subcategoría,
// ingredientes y presentaciones (la de empaques, con grupos de opciones, tiene su propio archivo).
jest.mock("../models/CustomQuoteRawMaterialOption.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() }
}))
jest.mock("../models/CustomQuoteIngredientOption.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() }
}))
jest.mock("../models/CustomQuotePresentationOption.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() }
}))
jest.mock("../../category/models/SubCategory.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../rawMaterial/models/RawMaterial.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../ingredient/models/Ingredient.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../presentation/models/Presentation.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))

import CustomQuoteRawMaterialOption from "../models/CustomQuoteRawMaterialOption.model"
import CustomQuoteIngredientOption from "../models/CustomQuoteIngredientOption.model"
import CustomQuotePresentationOption from "../models/CustomQuotePresentationOption.model"
import SubCategory from "../../category/models/SubCategory.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import Presentation from "../../presentation/models/Presentation.model"
import { customQuoteRawMaterialOptionService } from "./customQuoteRawMaterialOption.service"
import { customQuoteIngredientOptionService } from "./customQuoteIngredientOption.service"
import { customQuotePresentationOptionService } from "./customQuotePresentationOption.service"

function mocked(fn: unknown): jest.Mock {
    return fn as jest.Mock
}

function existingRow(values: Record<string, unknown>) {
    const row: Record<string, unknown> = { isActive: true, ...values }
    row.update = jest.fn(async (changes: Record<string, unknown>) => ({ ...row, ...changes }))
    return row
}

beforeEach(() => {
    for (const model of [CustomQuoteRawMaterialOption, CustomQuoteIngredientOption, CustomQuotePresentationOption]) {
        mocked(model.findOne).mockReset().mockResolvedValue(null)
        mocked(model.findAll).mockReset().mockResolvedValue([])
        mocked(model.create).mockReset().mockImplementation(async (input) => ({ id: 99, ...input }))
    }
    mocked(SubCategory.findOne).mockReset().mockResolvedValue({ id: 3 })
    mocked(RawMaterial.findOne).mockReset().mockResolvedValue({ id: 7 })
    mocked(Ingredient.findOne).mockReset().mockResolvedValue({ id: 4 })
    mocked(Presentation.findOne).mockReset().mockResolvedValue({ id: 2, netWeightGrams: "500.00" })
})

describe("customQuoteRawMaterialOptionService", () => {
    const INPUT = { subCategoryId: 3, rawMaterialId: 7, minPercentage: null, maxPercentage: null }

    it("crea la fila cuando subcategoría y materia prima están activas", async () => {
        await customQuoteRawMaterialOptionService.createRawMaterialOption({ ...INPUT, minPercentage: 10, maxPercentage: 60 })

        expect(SubCategory.findOne).toHaveBeenCalledWith({ where: { id: 3, isActive: true } })
        expect(RawMaterial.findOne).toHaveBeenCalledWith({ where: { id: 7, isActive: true } })
        expect(CustomQuoteRawMaterialOption.create).toHaveBeenCalledWith({ ...INPUT, minPercentage: 10, maxPercentage: 60 })
    })

    it("subcategoría inexistente o inactiva -> 404", async () => {
        mocked(SubCategory.findOne).mockResolvedValue(null)

        await expect(customQuoteRawMaterialOptionService.createRawMaterialOption(INPUT))
            .rejects.toMatchObject({ statusCode: 404, params: { resource: "SubCategory", id: 3 } })
        expect(CustomQuoteRawMaterialOption.create).not.toHaveBeenCalled()
    })

    it("materia prima inexistente o inactiva -> 404", async () => {
        mocked(RawMaterial.findOne).mockResolvedValue(null)

        await expect(customQuoteRawMaterialOptionService.createRawMaterialOption(INPUT))
            .rejects.toMatchObject({ statusCode: 404, params: { resource: "RawMaterial", id: 7 } })
    })

    it("mínimo mayor que el máximo -> 422, al crear y al editar", async () => {
        await expect(customQuoteRawMaterialOptionService.createRawMaterialOption({ ...INPUT, minPercentage: 70, maxPercentage: 30 }))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_min_greater_than_max" })

        const row = existingRow({ id: 1, subCategoryId: 3, rawMaterialId: 7 })
        mocked(CustomQuoteRawMaterialOption.findOne).mockResolvedValue(row)
        await expect(customQuoteRawMaterialOptionService.updateRawMaterialOption(1, { minPercentage: 70, maxPercentage: 30 }))
            .rejects.toMatchObject({ statusCode: 422 })
        expect(row.update).not.toHaveBeenCalled()
    })

    it("mínimo igual al máximo se permite (porcentaje fijo dentro de la mezcla)", async () => {
        await customQuoteRawMaterialOptionService.createRawMaterialOption({ ...INPUT, minPercentage: 50, maxPercentage: 50 })

        expect(CustomQuoteRawMaterialOption.create).toHaveBeenCalled()
    })

    it("el par (subcategoría, materia prima) ya existe, aun desactivado -> 409", async () => {
        mocked(CustomQuoteRawMaterialOption.findOne).mockResolvedValue(existingRow({ id: 1, isActive: false }))

        await expect(customQuoteRawMaterialOptionService.createRawMaterialOption(INPUT))
            .rejects.toMatchObject({ statusCode: 409, key: "errors.custom_quote_option_already_exists" })
        expect(CustomQuoteRawMaterialOption.findOne).toHaveBeenCalledWith({ where: { subCategoryId: 3, rawMaterialId: 7 } })
    })

    it("editar solo toca min/max", async () => {
        const row = existingRow({ id: 1, subCategoryId: 3, rawMaterialId: 7 })
        mocked(CustomQuoteRawMaterialOption.findOne).mockResolvedValue(row)

        await customQuoteRawMaterialOptionService.updateRawMaterialOption(1, { minPercentage: null, maxPercentage: 40 })

        expect(row.update).toHaveBeenCalledWith({ minPercentage: null, maxPercentage: 40 })
    })

    it("listar filtra por subcategoría y castea los DECIMAL a número", async () => {
        mocked(CustomQuoteRawMaterialOption.findAll).mockResolvedValue([
            existingRow({
                id: 1, subCategoryId: 3, rawMaterialId: 7, minPercentage: "10.00", maxPercentage: null,
                subCategory: { displayName: "Mezclas de fruta" },
                usedRawMaterial: { code: "MP-7", displayName: "Piña", isMixable: true, isOrganic: false },
            })
        ])

        const result = await customQuoteRawMaterialOptionService.listRawMaterialOptions(3)

        expect(mocked(CustomQuoteRawMaterialOption.findAll).mock.calls[0][0].where).toEqual({ subCategoryId: 3 })
        expect(result).toEqual([expect.objectContaining({
            subCategoryName: "Mezclas de fruta", rawMaterialName: "Piña", isMixable: true, minPercentage: 10, maxPercentage: null
        })])
    })

    it("reactivar exige que la materia prima siga activa", async () => {
        mocked(CustomQuoteRawMaterialOption.findOne).mockResolvedValue(existingRow({ id: 1, subCategoryId: 3, rawMaterialId: 7, isActive: false }))
        mocked(RawMaterial.findOne).mockResolvedValue(null)

        await expect(customQuoteRawMaterialOptionService.setRawMaterialOptionStatus(1, true))
            .rejects.toMatchObject({ statusCode: 404 })
    })

    it("desactivar no revisa el catálogo", async () => {
        const row = existingRow({ id: 1, subCategoryId: 3, rawMaterialId: 7 })
        mocked(CustomQuoteRawMaterialOption.findOne).mockResolvedValue(row)
        mocked(RawMaterial.findOne).mockResolvedValue(null)

        await customQuoteRawMaterialOptionService.setRawMaterialOptionStatus(1, false)

        expect(row.update).toHaveBeenCalledWith({ isActive: false })
    })
})

describe("customQuoteIngredientOptionService", () => {
    it("crea con el tope opcional", async () => {
        await customQuoteIngredientOptionService.createIngredientOption({ ingredientId: 4, maxGramsPerKg: 20 })

        expect(CustomQuoteIngredientOption.create).toHaveBeenCalledWith({ ingredientId: 4, maxGramsPerKg: 20 })
    })

    it("ingrediente inexistente o inactivo -> 404", async () => {
        mocked(Ingredient.findOne).mockResolvedValue(null)

        await expect(customQuoteIngredientOptionService.createIngredientOption({ ingredientId: 4, maxGramsPerKg: null }))
            .rejects.toMatchObject({ statusCode: 404, params: { resource: "Ingredient", id: 4 } })
    })

    it("ingrediente ya en la lista -> 409", async () => {
        mocked(CustomQuoteIngredientOption.findOne).mockResolvedValue(existingRow({ id: 1 }))

        await expect(customQuoteIngredientOptionService.createIngredientOption({ ingredientId: 4, maxGramsPerKg: null }))
            .rejects.toMatchObject({ statusCode: 409 })
    })

    it("editar reemplaza el tope (null lo quita)", async () => {
        const row = existingRow({ id: 1, ingredientId: 4, maxGramsPerKg: "20.000" })
        mocked(CustomQuoteIngredientOption.findOne).mockResolvedValue(row)

        await customQuoteIngredientOptionService.updateIngredientOption(1, { maxGramsPerKg: null })

        expect(row.update).toHaveBeenCalledWith({ maxGramsPerKg: null })
    })

    it("el DTO castea el tope a número", async () => {
        mocked(CustomQuoteIngredientOption.findOne).mockResolvedValue(existingRow({
            id: 1, ingredientId: 4, maxGramsPerKg: "20.000", usedIngredient: { code: "SAL", displayName: "Sal" }
        }))

        const dto = await customQuoteIngredientOptionService.getIngredientOptionById(1)

        expect(dto).toMatchObject({ ingredientCode: "SAL", ingredientName: "Sal", maxGramsPerKg: 20 })
    })
})

describe("customQuotePresentationOptionService", () => {
    const INPUT = { presentationId: 2, boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: null }

    it("crea con la composición de palet del admin", async () => {
        await customQuotePresentationOptionService.createPresentationOption(INPUT)

        expect(Presentation.findOne).toHaveBeenCalledWith({ where: { id: 2, isActive: true } })
        expect(CustomQuotePresentationOption.create).toHaveBeenCalledWith(INPUT)
    })

    it("presentación inexistente o inactiva -> 404", async () => {
        mocked(Presentation.findOne).mockResolvedValue(null)

        await expect(customQuotePresentationOptionService.createPresentationOption(INPUT))
            .rejects.toMatchObject({ statusCode: 404, params: { resource: "Presentation", id: 2 } })
    })

    it("presentación sin peso neto -> 422, no se puede ofrecer", async () => {
        mocked(Presentation.findOne).mockResolvedValue({ id: 2, netWeightGrams: null })

        await expect(customQuotePresentationOptionService.createPresentationOption(INPUT))
            .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_presentation_missing_net_weight" })
        expect(CustomQuotePresentationOption.create).not.toHaveBeenCalled()
    })

    it("presentación ya ofrecida -> 409", async () => {
        mocked(CustomQuotePresentationOption.findOne).mockResolvedValue(existingRow({ id: 1 }))

        await expect(customQuotePresentationOptionService.createPresentationOption(INPUT))
            .rejects.toMatchObject({ statusCode: 409 })
    })

    it("editar reemplaza las tres cuentas", async () => {
        const row = existingRow({ id: 1, presentationId: 2, boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: 6 })
        mocked(CustomQuotePresentationOption.findOne).mockResolvedValue(row)

        await customQuotePresentationOptionService.updatePresentationOption(1, {
            boxesPerPallet: 50, bagsPerBox: 10, unitsPerIntermediatePackage: null
        })

        expect(row.update).toHaveBeenCalledWith({ boxesPerPallet: 50, bagsPerBox: 10, unitsPerIntermediatePackage: null })
    })

    it("el DTO trae la etiqueta y el peso neto como número", async () => {
        mocked(CustomQuotePresentationOption.findAll).mockResolvedValue([existingRow({
            id: 1, presentationId: 2, boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: null,
            presentation: { displayLabel: "Bolsa 500 g", netWeightGrams: "500.00" }
        })])

        const [dto] = await customQuotePresentationOptionService.listPresentationOptions()

        expect(dto).toEqual(expect.objectContaining({ presentationLabel: "Bolsa 500 g", netWeightGrams: 500, unitsPerIntermediatePackage: null }))
    })

    it("reactivar exige que la presentación siga teniendo peso neto", async () => {
        mocked(CustomQuotePresentationOption.findOne).mockResolvedValue(existingRow({ id: 1, presentationId: 2, isActive: false }))
        mocked(Presentation.findOne).mockResolvedValue({ id: 2, netWeightGrams: "0.00" })

        await expect(customQuotePresentationOptionService.setPresentationOptionStatus(1, true))
            .rejects.toMatchObject({ statusCode: 422 })
    })
})
