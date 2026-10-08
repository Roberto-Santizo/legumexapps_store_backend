jest.mock("../models/Product.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(),
        sequelize: new (jest.requireActual("sequelize").Sequelize)("postgres://test:test@localhost/test", { logging: false }) }
}))
jest.mock("../models/ProductVariant.model", () => ({ __esModule: true, default: {} }))
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
import ProductVariant from "../models/ProductVariant.model"
import { DataTypes, FindOptions, Op, Sequelize } from "sequelize"

const mockProductFindOne = Product.findOne as unknown as jest.Mock
const mockProductCreate = Product.create as unknown as jest.Mock
const mockClientFindOne = Client.findOne as unknown as jest.Mock

describe("productService.listProducts", () => {
    const findAll = jest.mocked(Product.findAll)
    const findAndCountAll = Product.findAndCountAll as unknown as jest.Mock<Promise<{ rows: Product[]; count: number }>, [FindOptions<Product>]>
    beforeEach(() => { findAll.mockReset(); findAndCountAll.mockReset() })

    it("orders newest first with a stable id tie breaker before pagination", async () => {
        findAndCountAll.mockResolvedValue({ rows: [], count: 21 })
        const result = await productService.listProducts({ page: 2, limit: 10 })
        expect(findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
            order: [["createdAt", "DESC"], ["id", "DESC"]], limit: 10, offset: 10, distinct: true,
        }))
        expect(result.meta).toEqual({ page: 2, limit: 10, total: 21, totalPages: 3 })
    })

    it.each(["FRESA-40OZ", "fresa-40oz"])("searches a variant SKU %s and preserves name search", async (search) => {
        findAndCountAll.mockResolvedValue({ rows: [], count: 0 })
        await productService.listProducts({ page: 1 }, search)
        const options = findAndCountAll.mock.calls[0][0]
        expect(options?.where).toEqual({ [Op.or]: [
            { displayName: { [Op.iLike]: `%${search}%` } },
            expect.objectContaining({ val: expect.stringContaining(`"skuVariant"."skuCode" ILIKE '%${search}%'`) }),
        ] })
        expect(options).toMatchObject({ limit: 10, offset: 0, order: [["createdAt", "DESC"], ["id", "DESC"]] })
    })

    it("loads all SKUs in a separate page batch, without filtering the displayed variants", async () => {
        const rows = [{ id: 2, productVariants: [{ id: 3, skuCode: "SKU-B-001" }, { id: 4, skuCode: "SKU-B-002" }] }] as Product[]
        findAndCountAll.mockResolvedValue({ rows, count: 1 })
        const result = await productService.listProducts({ page: 1 }, "SKU-B")
        expect(result.data).toEqual(rows)
        expect(result.meta?.total).toBe(1)
        expect(findAndCountAll.mock.calls[0][0]?.include).toEqual(expect.arrayContaining([
            { model: ProductVariant, as: "productVariants", attributes: ["id", "productId", "skuCode"], separate: true, order: [["id", "ASC"]] },
        ]))
    })

    it("uses a correlated EXISTS rather than a multiplying search JOIN", async () => {
        findAndCountAll.mockResolvedValue({ rows: [], count: 0 })
        await productService.listProducts({ page: 3, limit: 5 }, "SKU")
        expect(findAndCountAll.mock.calls[0][0]?.where).toEqual({ [Op.or]: [expect.anything(),
            expect.objectContaining({ val: expect.stringContaining('EXISTS (SELECT 1 FROM "productVariants" AS "skuVariant" WHERE "skuVariant"."productId" = "Product"."id"') }),
        ] })
        expect(findAndCountAll.mock.calls[0][0]).toMatchObject({ offset: 10, limit: 5, distinct: true })
    })

    it("escapes SQL quotes and treats SKU percent/underscore characters literally", async () => {
        findAll.mockResolvedValue([])
        await productService.listProducts(undefined, "SKU'_%")
        expect(findAll.mock.calls[0][0]?.where).toEqual({ [Op.or]: [expect.anything(),
            expect.objectContaining({ val: expect.stringContaining("ILIKE '%SKU''\\_\\%%'") }),
        ] })
    })

    it("keeps the unpaginated response compatible and applies the same order", async () => {
        findAll.mockResolvedValue([])
        expect(await productService.listProducts()).toEqual({ data: [] })
        expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ where: {}, order: [["createdAt", "DESC"], ["id", "DESC"]] }))
    })

    it("generates PostgreSQL with SKU filtering and stable ordering before LIMIT, without a variant JOIN", async () => {
        findAndCountAll.mockResolvedValue({ rows: [], count: 0 })
        await productService.listProducts({ page: 2, limit: 5 }, "SKU-B")
        const options = findAndCountAll.mock.calls[0][0]
        // Real Sequelize SQL generation; intercept execution so no database is contacted.
        const sequelize = new Sequelize("postgres://test:test@localhost/test", { logging: false })
        const parent = sequelize.define("Product", { displayName: DataTypes.STRING }, { tableName: "products" })
        const variant = sequelize.define("ProductVariant", { productId: DataTypes.INTEGER, skuCode: DataTypes.STRING }, { tableName: "productVariants" })
        parent.hasMany(variant, { as: "productVariants", foreignKey: "productId" })
        const query = jest.spyOn(sequelize, "query").mockResolvedValue([] as never)
        await parent.findAll({
            where: options.where, order: options.order, limit: options.limit, offset: options.offset,
            include: [{ model: variant, as: "productVariants", separate: true, attributes: ["id", "productId", "skuCode"] }],
        })
        const sql = query.mock.calls[0][0]
        expect(sql).toEqual(expect.stringContaining('"skuVariant"."productId" = "Product"."id"'))
        expect(sql).toEqual(expect.stringContaining("ILIKE '%SKU-B%'"))
        expect(sql).toEqual(expect.stringContaining('ORDER BY "Product"."createdAt" DESC, "Product"."id" DESC LIMIT 5 OFFSET 5'))
        expect(sql).not.toEqual(expect.stringContaining(" JOIN "))
        query.mockResolvedValue({ count: 2 } as never)
        await parent.count({ where: options.where, distinct: true, col: "id" })
        expect(query.mock.calls[1][0]).toEqual(expect.stringContaining('count(DISTINCT("id"))'))
        expect(query.mock.calls[1][0]).toEqual(expect.stringContaining("EXISTS"))
        await sequelize.close()
    })
})

// Product.findOne se llama con varias formas de `where` dentro de un createProduct (urlSlug único y
// el findActiveProduct final): se distingue por la clave presente.
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
