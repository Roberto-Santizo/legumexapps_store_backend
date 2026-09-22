import "reflect-metadata"
import { Op } from "sequelize"


jest.mock("../models/ProductVariant.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn() }
}))

import ProductVariant from "../models/ProductVariant.model"
import { productVariantService } from "./productVariant.service"

const mockVariantFindOne = ProductVariant.findOne as unknown as jest.Mock
const mockVariantCreate = ProductVariant.create as unknown as jest.Mock

const BASE_CREATE_INPUT = {
    productId: 1,
    presentationId: 3,
    boxesPerPallet: 385,
    bagsPerBox: 6,
}

// ProductVariant.findOne se llama con dos shapes de `where` distintas dentro de un solo
// create/update (chequeo de (productId, presentationId) único, y getProductVariantById) -- se
// distingue por la clave presente en `where`. "presentationId" e "isActive" nunca coexisten en la
// misma llamada, así que alcanza con mirar cuál de las dos está presente (mismo patrón que
// mockProcessingCostFindAll en quote.service.test.ts).
function stubVariantFindOne(responses: {
    presentation?: unknown
    existing?: unknown
}): void {
    mockVariantFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if ("presentationId" in where) return Promise.resolve(responses.presentation ?? null)
        if ("isActive" in where) return Promise.resolve(responses.existing ?? null)
        return Promise.resolve(null)
    })
}

describe("productVariantService.createProductVariant", () => {
    beforeEach(() => {
        mockVariantFindOne.mockReset()
        mockVariantCreate.mockReset()
    })

    it("crea la variante cuando la Presentación está libre en ese producto", async () => {
        mockVariantFindOne.mockResolvedValue(null)
        mockVariantCreate.mockResolvedValue({ id: 1, ...BASE_CREATE_INPUT })

        const result = await productVariantService.createProductVariant(BASE_CREATE_INPUT)

        expect(mockVariantCreate).toHaveBeenCalledWith(expect.objectContaining({ productId: 1, presentationId: 3 }))
        expect(result.presentationId).toBe(3)
    })

    describe("un SKU por (producto, Presentación) -- 2026-09-16, enforced a nivel de aplicación (identidad completa del SKU desde 2026-09-17)", () => {
        it("rechaza crear un SKU si el producto ya tiene OTRO SKU para la misma Presentación", async () => {
            stubVariantFindOne({ presentation: { id: 9, productId: 1, presentationId: 3 } })

            await expect(productVariantService.createProductVariant(BASE_CREATE_INPUT)).rejects.toMatchObject({
                statusCode: 409,
                key: "errors.product_variant_presentation_already_used",
            })
            expect(mockVariantCreate).not.toHaveBeenCalled()
        })

        it("la búsqueda de duplicado está acotada al producto (productId + presentationId, no global)", async () => {
            mockVariantFindOne.mockResolvedValue(null)
            mockVariantCreate.mockResolvedValue({ id: 1, ...BASE_CREATE_INPUT })

            await productVariantService.createProductVariant(BASE_CREATE_INPUT)

            expect(mockVariantFindOne).toHaveBeenCalledWith(
                expect.objectContaining({ where: { productId: 1, presentationId: 3 } })
            )
        })
    })
})

describe("productVariantService.updateProductVariant", () => {
    beforeEach(() => {
        mockVariantFindOne.mockReset()
    })

    it("permite guardar sin cambiar de presentationId (la unicidad no se compara consigo misma)", async () => {
        const mockUpdate = jest.fn().mockResolvedValue(undefined)
        stubVariantFindOne({
            existing: { id: 1, productId: 1, presentationId: 3, update: mockUpdate },
        })

        await productVariantService.updateProductVariant(1, BASE_CREATE_INPUT)

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ presentationId: 3 }))
    })

    describe("Presentación inmutable una vez creado el SKU (Opción B, 2026-09-16)", () => {
        it("rechaza cambiar la Presentación de un SKU ya guardado", async () => {
            const mockUpdate = jest.fn()
            stubVariantFindOne({
                existing: { id: 1, productId: 1, presentationId: 3, update: mockUpdate },
            })

            await expect(
                productVariantService.updateProductVariant(1, { ...BASE_CREATE_INPUT, presentationId: 9 })
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.product_variant_presentation_immutable" })
            expect(mockUpdate).not.toHaveBeenCalled()
        })

        it("no rechaza si el update ni siquiera toca presentationId (permanece igual al guardado)", async () => {
            const mockUpdate = jest.fn().mockResolvedValue(undefined)
            stubVariantFindOne({
                existing: { id: 1, productId: 1, presentationId: 3, update: mockUpdate },
            })

            await productVariantService.updateProductVariant(1, { boxesPerPallet: 385, bagsPerBox: 6, presentationId: 3 })

            expect(mockUpdate).toHaveBeenCalledTimes(1)
        })
    })

    describe("un SKU por (producto, Presentación) también aplica si se reasigna la variante a otro Producto", () => {
        it("al mover la variante a OTRO producto, rechaza si ese producto ya tiene un SKU para la misma Presentación", async () => {
            const mockUpdate = jest.fn()
            stubVariantFindOne({
                presentation: { id: 9, productId: 2, presentationId: 3 }, // el producto destino ya tiene un SKU en esa Presentación
                existing: { id: 1, productId: 1, presentationId: 3, update: mockUpdate },
            })

            await expect(
                productVariantService.updateProductVariant(1, { ...BASE_CREATE_INPUT, productId: 2 })
            ).rejects.toMatchObject({
                statusCode: 409,
                key: "errors.product_variant_presentation_already_used",
            })

            expect(mockVariantFindOne).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ productId: 2, presentationId: 3, id: { [Op.ne]: 1 } }) })
            )
            expect(mockUpdate).not.toHaveBeenCalled()
        })
    })
})
