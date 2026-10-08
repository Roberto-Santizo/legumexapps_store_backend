jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" } }))
jest.mock("../services/catalogQuoteDiscovery.service", () => ({ discoverCatalog: jest.fn() }))
jest.mock("../services/catalogQuote.service", () => ({ previewCatalogQuote: jest.fn(), confirmCatalogQuote: jest.fn() }))
import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./customQuote.routes"
import { discoverCatalog } from "../services/catalogQuoteDiscovery.service"
import { previewCatalogQuote, confirmCatalogQuote } from "../services/catalogQuote.service"
import { AppError } from "../../../shared/errors/AppError"
const app = buildTestApp("/api/custom-quotes", router)
const token = `Bearer ${jwt.sign({ sub: 42, type: "customer" }, "test-secret")}`
const input = { categoryId: 1, subCategoryId: 3, configurationId: 5, ingredientType: "fruit", isOrganic: false, requestedPallets: 1, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }] }
it.each(["configurations", "catalog-preview", "catalog-confirm"])("requires salesperson authentication for %s", async path => {
    const res = path === "configurations" ? await request(app).get(`/api/custom-quotes/${path}`) : await request(app).post(`/api/custom-quotes/${path}`).send(input)
    expect(res.status).toBe(401)
})
it("returns commercial discovery", async () => {
    (discoverCatalog as jest.Mock).mockResolvedValue({ categories: [] })
    const res = await request(app).get("/api/custom-quotes/configurations").set("Authorization", token)
    expect(res.status).toBe(200); expect(res.body.data).toEqual({ categories: [] })
})
it("preview validates strict input and forwards authenticated owner", async () => {
    (previewCatalogQuote as jest.Mock).mockResolvedValue({ totalCost: 1, previewToken: "signed" })
    const res = await request(app).post("/api/custom-quotes/catalog-preview").set("Authorization", token).send(input)
    expect(res.status).toBe(200); expect(previewCatalogQuote).toHaveBeenCalledWith(42, expect.objectContaining(input), expect.any(String))
    const invalid = await request(app).post("/api/custom-quotes/catalog-preview").set("Authorization", token).send({ ...input, totalCost: 1 })
    expect(invalid.status).toBe(400)
})
it("confirmation validates UUID/token and returns controlled catalog conflict", async () => {
    const body = { input, previewToken: "signed", confirmationKey: "01234567-89ab-4cde-8abc-0123456789ab" }
    ;(confirmCatalogQuote as jest.Mock).mockRejectedValue(new AppError(409, "errors.catalog_quote_changed"))
    const res = await request(app).post("/api/custom-quotes/catalog-confirm").set("Authorization", token).send(body)
    expect(res.status).toBe(409)
    const invalid = await request(app).post("/api/custom-quotes/catalog-confirm").set("Authorization", token).send({ ...body, confirmationKey: "bad" })
    expect(invalid.status).toBe(400)
})
