jest.mock("../models/Product.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn() }
}))
jest.mock("../models/ProductTranslation.model", () => ({
    __esModule: true,
    default: { findOrCreate: jest.fn() }
}))
jest.mock("../../client/models/Client.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))

import Product from "../models/Product.model"
import Client from "../../client/models/Client.model"
import { productService } from "./product.service"

const mockProductFindOne = Product.findOne as unknown as jest.Mock
const mockProductCreate = Product.create as unknown as jest.Mock
const mockClientFindOne = Client.findOne as unknown as jest.Mock

// Product.findOne se llama con tres shapes distintas de `where` dentro de un solo createProduct
// (chequeo de codigo único, chequeo de urlSlug único, y el findActiveProduct final) -- se
// distingue por la clave presente en `where`, mismo patrón que mockProcessingCostFindAll en
// quote.service.test.ts.
function stubProductFindOneHappyPath(finalProduct: Record<string, unknown>): void {
    mockProductFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if ("urlSlug" in where) return Promise.resolve(null) // slug libre
        if ("id" in where) return Promise.resolve(finalProduct) // findActiveProduct
        return Promise.resolve(null)
    })
}

const validCreateInput = {

    subCategoryId: 1,
    clientId: 7,
    displayName: "Piña en Trozos",
}

describe("productService.createProduct -- clientId (2026-09-16, requerido)", () => {
    beforeEach(() => {
        mockProductFindOne.mockReset()
        mockProductCreate.mockReset()
        mockClientFindOne.mockReset()
    })

    it("rechaza con NotFoundError si el clientId no resuelve a ningún Client (mismo criterio que un Client inactivo)", async () => {
        mockClientFindOne.mockResolvedValue(null)

        await expect(productService.createProduct(validCreateInput as never)).rejects.toMatchObject({
            statusCode: 404,
            key: "errors.not_found",
            params: expect.objectContaining({ resource: "Client", id: 7 }),
        })
        expect(mockProductCreate).not.toHaveBeenCalled()
    })

    it("consulta el Client filtrando isActive:true -- un Cliente desactivado no es una referencia válida", async () => {
        mockClientFindOne.mockResolvedValue(null)

        await expect(productService.createProduct(validCreateInput as never)).rejects.toMatchObject({ statusCode: 404 })

        expect(mockClientFindOne).toHaveBeenCalledWith({ where: { id: 7, isActive: true } })
    })

    it("crea el producto y persiste clientId cuando el Client existe y está activo", async () => {
        mockClientFindOne.mockResolvedValue({ id: 7, name: "Acme SA", isActive: true })
        mockProductCreate.mockResolvedValue({ id: 100 })
        stubProductFindOneHappyPath({ id: 100, ...validCreateInput, urlSlug: "pina-en-trozos" })

        await productService.createProduct(validCreateInput as never)

        expect(mockProductCreate).toHaveBeenCalledWith(
            expect.objectContaining({ clientId: 7 })
        )
    })

    it("valida el clientId ANTES de crear -- nunca llega a Product.create si el Client no existe", async () => {
        mockClientFindOne.mockResolvedValue(null)
        stubProductFindOneHappyPath({ id: 100 })

        await expect(productService.createProduct(validCreateInput as never)).rejects.toBeDefined()

        expect(mockProductCreate).not.toHaveBeenCalled()
    })
})

describe("productService.updateProduct -- clientId (2026-09-16, requerido también al editar)", () => {
    beforeEach(() => {
        mockProductFindOne.mockReset()
        mockClientFindOne.mockReset()
    })

    function stubExistingProduct(overrides: Record<string, unknown> = {}) {
        const existing = {
            id: 5,

            clientId: 7,
            imageUrl: null,
            update: jest.fn().mockResolvedValue(undefined),
            ...overrides,
        }
        mockProductFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("id" in where) return Promise.resolve(existing)
            return Promise.resolve(null)
        })
        return existing
    }

    it("rechaza con NotFoundError si el nuevo clientId no resuelve a ningún Client activo", async () => {
        stubExistingProduct()
        mockClientFindOne.mockResolvedValue(null)

        await expect(
            productService.updateProduct(5, { clientId: 999 } as never)
        ).rejects.toMatchObject({ statusCode: 404, key: "errors.not_found", params: expect.objectContaining({ resource: "Client", id: 999 }) })
    })

    it("persiste el nuevo clientId cuando el Client existe y está activo", async () => {
        const existing = stubExistingProduct()
        mockClientFindOne.mockResolvedValue({ id: 9, name: "Otro Cliente", isActive: true })

        await productService.updateProduct(5, { clientId: 9 } as never)

        expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({ clientId: 9 }))
    })
})
