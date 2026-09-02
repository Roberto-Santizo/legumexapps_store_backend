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

describe("productIngredientService.createProductIngredient", () => {
    describe("producto customizable (isCustomizable=true)", () => {
        beforeEach(() => {
            mockProductFindOne.mockResolvedValue({ isCustomizable: true })
        })

        it("rechaza un ingrediente no mezclable (isMixable=false) en el pool de un producto personalizable", async () => {
            mockIngredientFindOne.mockResolvedValue({ isMixable: false })

            await expect(
                productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, minPercentage: 0, maxPercentage: 100 } as never)
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.ingredient_not_mixable" })
            expect(mockCreate).not.toHaveBeenCalled()
        })

        it("acepta un ingrediente mezclable (isMixable=true)", async () => {
            mockIngredientFindOne.mockResolvedValue({ isMixable: true })
            mockCreate.mockResolvedValue({ id: 1 })

            await productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, minPercentage: 0, maxPercentage: 100 } as never)

            expect(mockCreate).toHaveBeenCalledTimes(1)
        })

        it("NO exige quantityValue en un producto customizable (usa min/maxPercentage en su lugar)", async () => {
            mockIngredientFindOne.mockResolvedValue({ isMixable: true })
            mockCreate.mockResolvedValue({ id: 1 })

            await productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, quantityValue: null } as never)

            expect(mockCreate).toHaveBeenCalledTimes(1)
        })
    })

    describe("producto de receta fija (isCustomizable=false)", () => {
        beforeEach(() => {
            mockProductFindOne.mockResolvedValue({ isCustomizable: false })
        })

        it("rechaza quantityValue vacío (bug histórico: la línea 'cuesta' $0 en cada cotización sin avisar)", async () => {
            await expect(
                productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, quantityValue: null } as never)
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.product_ingredient_quantity_required" })
        })

        it("rechaza quantityValue en 0", async () => {
            await expect(
                productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, quantityValue: 0 } as never)
            ).rejects.toMatchObject({ key: "errors.product_ingredient_quantity_required" })
        })

        it("rechaza quantityValue negativo", async () => {
            await expect(
                productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, quantityValue: -5 } as never)
            ).rejects.toMatchObject({ key: "errors.product_ingredient_quantity_required" })
        })

        it("acepta quantityValue positivo y no exige que el ingrediente sea mezclable", async () => {
            mockCreate.mockResolvedValue({ id: 1 })

            await productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, quantityValue: 0.5 } as never)

            expect(mockCreate).toHaveBeenCalledTimes(1)
            // En receta fija ni siquiera se debería consultar isMixable -- el ingrediente no se mezcla.
            expect(mockIngredientFindOne).not.toHaveBeenCalled()
        })
    })
})

describe("productIngredientService.createProductIngredient -- producto orgánico (Product.isOrganic)", () => {
    beforeEach(() => {
        mockProductFindOne.mockResolvedValue({ isOrganic: true, isCustomizable: false })
    })

    it("rechaza un ingrediente convencional (isOrganic=false, ingredientType='fruit') en un producto orgánico", async () => {
        mockIngredientFindOne.mockResolvedValue({ isMixable: true, isOrganic: false, ingredientType: "fruit" })

        await expect(
            productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, quantityValue: 0.5 } as never)
        ).rejects.toMatchObject({ statusCode: 422, key: "errors.ingredient_not_organic_compatible" })
        expect(mockCreate).not.toHaveBeenCalled()
    })

    it("acepta la variante orgánica de un ingrediente (isOrganic=true)", async () => {
        mockIngredientFindOne.mockResolvedValue({ isMixable: true, isOrganic: true, ingredientType: "fruit" })
        mockCreate.mockResolvedValue({ id: 1 })

        await productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, quantityValue: 0.5 } as never)

        expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it("acepta un insumo tipo 'other' (agua, sal, azúcar...) aunque no esté marcado orgánico -- no tiene variante orgánica/convencional", async () => {
        mockIngredientFindOne.mockResolvedValue({ isMixable: true, isOrganic: false, ingredientType: "other" })
        mockCreate.mockResolvedValue({ id: 1 })

        await productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, quantityValue: 0.5 } as never)

        expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it("no exige nada de esto si el producto NO es orgánico", async () => {
        mockProductFindOne.mockResolvedValue({ isOrganic: false, isCustomizable: false })
        mockCreate.mockResolvedValue({ id: 1 })

        await productIngredientService.createProductIngredient({ productId: 1, ingredientId: 9, quantityValue: 0.5 } as never)

        expect(mockIngredientFindOne).not.toHaveBeenCalled()
        expect(mockCreate).toHaveBeenCalledTimes(1)
    })
})

describe("productIngredientService.updateProductIngredient", () => {
    it("re-valida quantityValue contra el producto EFECTIVO (el nuevo productId del input, no el viejo) al editar", async () => {
        const existing = {
            id: 5,
            productId: 1,
            ingredientId: 9,
            quantityValue: 0.5,
            update: jest.fn().mockResolvedValue({ id: 5 }),
        }
        ;(ProductIngredient.findOne as unknown as jest.Mock).mockResolvedValue(existing)
        // Se está moviendo esta fila a productId=2, que resulta ser un producto de receta fija.
        mockProductFindOne.mockResolvedValue({ isCustomizable: false })

        await expect(
            productIngredientService.updateProductIngredient(5, { productId: 2, quantityValue: null } as never)
        ).rejects.toMatchObject({ key: "errors.product_ingredient_quantity_required" })
        expect(mockProductFindOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 } }))
    })

    it("si el input no manda quantityValue, revalida con el valor ya guardado (no lo trata como vacío)", async () => {
        const existing = {
            id: 5,
            productId: 1,
            ingredientId: 9,
            quantityValue: 0.5,
            update: jest.fn().mockResolvedValue({ id: 5 }),
        }
        ;(ProductIngredient.findOne as unknown as jest.Mock).mockResolvedValue(existing)
        mockProductFindOne.mockResolvedValue({ isCustomizable: false })

        await productIngredientService.updateProductIngredient(5, { displayOrder: 3 } as never)

        expect(existing.update).toHaveBeenCalledTimes(1)
    })
})
