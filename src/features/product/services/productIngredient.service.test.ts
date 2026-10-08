jest.mock("../models/ProductIngredient.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() }
}))
jest.mock("../models/Product.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
jest.mock("../../ingredient/models/Ingredient.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))

import ProductIngredient from "../models/ProductIngredient.model"
import Product from "../models/Product.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import { productIngredientService } from "./productIngredient.service"

const mockProductFindOne = Product.findOne as unknown as jest.Mock
const mockIngredientFindOne = Ingredient.findOne as unknown as jest.Mock
const mockCreate = ProductIngredient.create as unknown as jest.Mock
const mockRowFindOne = ProductIngredient.findOne as unknown as jest.Mock

const BASE_INPUT = { productId: 1, ingredientId: 9, grams: 40, referenceNetWeightGrams: 2000 }

describe("productIngredientService.createProductIngredient", () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockProductFindOne.mockResolvedValue({ id: 1, isCustomizable: false })
        mockIngredientFindOne.mockResolvedValue({ id: 9, isActive: true })
        mockCreate.mockImplementation((input: object) => Promise.resolve({ id: 1, ...input }))
    })

    it("crea la fila guardando gramos + peso de referencia tal cual (sin convertir a %)", async () => {
        await productIngredientService.createProductIngredient(BASE_INPUT)

        expect(mockCreate).toHaveBeenCalledWith(BASE_INPUT)
    })

    it.each([
        ["receta fija", false],
        ["receta personalizable", true],
    ])("aplica las mismas reglas en un producto de %s (no hay regla de 100%%)", async (_label, isCustomizable) => {
        mockProductFindOne.mockResolvedValue({ id: 1, isCustomizable })

        await productIngredientService.createProductIngredient({ ...BASE_INPUT, grams: 2000 })

        expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it("acepta gramos == peso de referencia (100% exacto es el límite, no se rechaza)", async () => {
        await productIngredientService.createProductIngredient({ ...BASE_INPUT, grams: 2000, referenceNetWeightGrams: 2000 })

        expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it("rechaza gramos > peso de referencia (typo guard) sin tocar la BD", async () => {
        await expect(
            productIngredientService.createProductIngredient({ ...BASE_INPUT, grams: 2500, referenceNetWeightGrams: 2000 })
        ).rejects.toMatchObject({
            statusCode: 422,
            key: "errors.product_ingredient_grams_exceed_reference",
            params: { grams: 2500, referenceNetWeightGrams: 2000 }
        })
        expect(mockCreate).not.toHaveBeenCalled()
    })

    it("rechaza un ingrediente inexistente o inactivo con NotFound", async () => {
        mockIngredientFindOne.mockResolvedValue(null)

        await expect(productIngredientService.createProductIngredient(BASE_INPUT)).rejects.toMatchObject({ statusCode: 404 })
        expect(mockIngredientFindOne).toHaveBeenCalledWith({ where: { id: 9, isActive: true } })
        expect(mockCreate).not.toHaveBeenCalled()
    })

    it("rechaza un producto inexistente con NotFound", async () => {
        mockProductFindOne.mockResolvedValue(null)

        await expect(productIngredientService.createProductIngredient(BASE_INPUT)).rejects.toMatchObject({ statusCode: 404 })
        expect(mockCreate).not.toHaveBeenCalled()
    })
})

describe("productIngredientService.updateProductIngredient", () => {
    const mockUpdate = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
        mockUpdate.mockImplementation((input: object) => Promise.resolve({ id: 5, ...input }))
        mockRowFindOne.mockResolvedValue({ id: 5, productId: 1, ingredientId: 9, update: mockUpdate })
        mockProductFindOne.mockResolvedValue({ id: 1 })
        mockIngredientFindOne.mockResolvedValue({ id: 9 })
    })

    it("actualiza gramos y peso de referencia", async () => {
        await productIngredientService.updateProductIngredient(5, { grams: 10, referenceNetWeightGrams: 500 })

        expect(mockUpdate).toHaveBeenCalledWith({ grams: 10, referenceNetWeightGrams: 500 })
    })

    it("rechaza gramos > peso de referencia en la edición", async () => {
        await expect(
            productIngredientService.updateProductIngredient(5, { grams: 600, referenceNetWeightGrams: 500 })
        ).rejects.toMatchObject({ statusCode: 422, key: "errors.product_ingredient_grams_exceed_reference" })
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it("rechaza cambiar a un ingrediente inactivo", async () => {
        mockIngredientFindOne.mockResolvedValue(null)

        await expect(
            productIngredientService.updateProductIngredient(5, { ingredientId: 77, grams: 10, referenceNetWeightGrams: 500 })
        ).rejects.toMatchObject({ statusCode: 404 })
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it("rechaza editar una fila inexistente", async () => {
        mockRowFindOne.mockResolvedValue(null)

        await expect(
            productIngredientService.updateProductIngredient(5, { grams: 10, referenceNetWeightGrams: 500 })
        ).rejects.toMatchObject({ statusCode: 404 })
    })
})
