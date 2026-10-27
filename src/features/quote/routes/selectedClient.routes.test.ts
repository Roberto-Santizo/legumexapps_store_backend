jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" } }))
jest.mock("../../client/models/Client.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../product/models/Product.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../product/models/ProductVariant.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../salesperson/services/representativeClient.service", () => ({ representativeClientService: { authorizedClientIds: jest.fn(), authorizedClients: jest.fn() } }))
jest.mock("../services/fixedQuote.service", () => ({ fixedQuoteService: { calculateQuote: jest.fn(), saveQuote: jest.fn(), listQuotableProducts: jest.fn() } }))
jest.mock("../../../shared/services/email.service", () => ({ emailService: {} }))
jest.mock("../../quoteDraft/services/quoteDraft.service", () => ({ quoteDraftService: { upsertFromCalculation: jest.fn() } }))
jest.mock("../services/productionOrder.service", () => ({ listProductionOrders: jest.fn() }))
jest.mock("../../customQuote/services/catalogQuoteDiscovery.service", () => ({ discoverCatalog: jest.fn() }))
jest.mock("../../customQuote/services/catalogQuote.service", () => ({ previewCatalogQuote: jest.fn(), confirmCatalogQuote: jest.fn() }))
import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./quote.routes"
import customRouter from "../../customQuote/routes/customQuote.routes"
import Client from "../../client/models/Client.model"
import Product from "../../product/models/Product.model"
import Variant from "../../product/models/ProductVariant.model"
import { representativeClientService as assignments } from "../../salesperson/services/representativeClient.service"
import { fixedQuoteService as engine } from "../services/fixedQuote.service"
import { confirmCatalogQuote } from "../../customQuote/services/catalogQuote.service"
const app = buildTestApp("/api/quotes", router)
const customApp = buildTestApp("/api/custom-quotes", customRouter)
const token = `Bearer ${jwt.sign({ sub: 42, type: "customer" }, "test-secret")}`
const order = { id: "72db466a-e594-48b7-9864-128b4b305b08", clientId: 11, clientName: "Forged label" }
beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(assignments.authorizedClientIds).mockResolvedValue([11, 12])
    jest.mocked(assignments.authorizedClients).mockResolvedValue([{ id: 11, name: "Walmart", isActive: true }, { id: 12, name: "HEB", isActive: true }])
    jest.mocked(Client.findOne).mockResolvedValue({ id: 11, name: "Walmart" } as never)
    jest.mocked(Variant.findOne).mockResolvedValue({ productId: 5 } as never)
    jest.mocked(Product.findOne).mockResolvedValue({ id: 5 } as never)
    jest.mocked(engine.listQuotableProducts).mockResolvedValue([])
    jest.mocked(engine.saveQuote).mockResolvedValue({ totalCost: 50 } as never)
    jest.mocked(engine.calculateQuote).mockResolvedValue({ totalCost: 50 } as never)
})
test("client selector is scoped to the authenticated representative", async () => {
    const response = await request(app).get("/api/quotes/clients").set("Authorization", token)
    expect(response.status).toBe(200)
    expect(response.body.data.map((client: any) => client.id)).toEqual([11, 12])
    expect(assignments.authorizedClients).toHaveBeenCalledWith(42)
})
test.each(["", "?clientId=0", "?clientId=11&clientId=12", "?clientId=invalid", "?clientId=9007199254740993"])("catalog rejects missing or malformed selections %s", async query => {
    expect((await request(app).get(`/api/quotes/products${query}`).set("Authorization", token)).status).toBe(400)
    expect(engine.listQuotableProducts).not.toHaveBeenCalled()
})
test.each([11, 12])("catalog only requests products of the selected assigned client %s", async clientId => {
    expect((await request(app).get(`/api/quotes/products?clientId=${clientId}`).set("Authorization", token)).status).toBe(200)
    expect(engine.listQuotableProducts).toHaveBeenCalledWith("es", [clientId])
})
test("unassigned client cannot request a catalog", async () => {
    expect((await request(app).get("/api/quotes/products?clientId=99").set("Authorization", token)).status).toBe(403)
    expect(engine.listQuotableProducts).not.toHaveBeenCalled()
})
test.each(["/api/quotes", "/api/quotes/preview"])("fixed operations require selected client and matching product at %s", async endpoint => {
    const send = (context: unknown) => request(app).post(endpoint).set("Authorization", token).send({ productVariantId: 10, requestedPallets: 1, order: context })
    expect((await send(undefined)).status).toBe(400)
    expect((await send({ ...order, clientId: null })).status).toBe(400)
    expect((await send({ ...order, clientId: 99 })).status).toBe(403)
    jest.mocked(Product.findOne).mockResolvedValueOnce(null)
    expect((await send(order)).status).toBe(403)
    expect(engine.saveQuote).not.toHaveBeenCalled(); expect(engine.calculateQuote).not.toHaveBeenCalled()
    expect((await send(order)).status).toBe(endpoint.endsWith("preview") ? 200 : 201)
    expect(Product.findOne).toHaveBeenLastCalledWith({ where: { id: 5, isActive: true, clientId: 11 }, attributes: ["id"] })
    if (!endpoint.endsWith("preview")) expect(engine.saveQuote).toHaveBeenCalledWith(42, expect.objectContaining({ order: { ...order, clientName: "Walmart" } }), "es")
})
test.each([11, null])("new-product confirmation supports assigned and new clients: %s", async clientId => {
    const input = { categoryId: 1, subCategoryId: 3, configurationId: 5, ingredientType: "fruit", requestedPallets: 1, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }] }
    const response = await request(customApp).post("/api/custom-quotes/catalog-confirm").set("Authorization", token).send({ input, previewToken: "preview", confirmationKey: order.id, order: { ...order, clientId } })
    expect(response.status).toBe(201)
    expect(confirmCatalogQuote).toHaveBeenCalledWith(42, expect.objectContaining({ order: { ...order, clientId, clientName: clientId ? "Walmart" : order.clientName } }), "es")
})
