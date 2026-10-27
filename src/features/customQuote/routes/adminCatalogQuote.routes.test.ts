jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/catalogQuoteDiscovery.service", () => ({ discoverCatalog: jest.fn() }))
jest.mock("../services/catalogQuote.service", () => ({ previewAdminCatalogQuote: jest.fn(), confirmCatalogQuote: jest.fn() }))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import adminCatalogQuoteRouter from "./adminCatalogQuote.routes"
import { discoverCatalog } from "../services/catalogQuoteDiscovery.service"
import { previewAdminCatalogQuote, confirmCatalogQuote } from "../services/catalogQuote.service"

const app = buildTestApp("/api/admin/quotes", adminCatalogQuoteRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

const salespersonToken = jwt.sign({ sub: 42, type: "customer" }, "test-secret")

describe("admin customizable calculator", () => {
    const input = { categoryId: 1, subCategoryId: 3, configurationId: 5, ingredientType: "fruit", requestedPallets: 2, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }] }
    const preview = "/api/admin/quotes/catalog-preview"
    const catalog = "/api/admin/quotes/catalog-configurations"
    it("requires staff and quotes:calculate for both catalog and calculation", async () => {
        for (const [token, status] of [["", 401], [salespersonToken, 401], [staffToken(["quotes:view"]), 403]] as const) {
            expect((await request(app).get(catalog).set("Authorization", `Bearer ${token}`)).status).toBe(status)
            expect((await request(app).post(preview).set("Authorization", `Bearer ${token}`).send(input)).status).toBe(status)
        }
        expect(previewAdminCatalogQuote).not.toHaveBeenCalled()
        expect(discoverCatalog).not.toHaveBeenCalled()
    })
    it("discovers and calculates without customer confirmation", async () => {
        const auth = `Bearer ${staffToken(["quotes:calculate"])}`
        ;(discoverCatalog as jest.Mock).mockResolvedValue({ categories: [] })
        ;(previewAdminCatalogQuote as jest.Mock).mockResolvedValue({ totalCost: 284, requestedPallets: 2 })
        expect((await request(app).get(catalog).set("Authorization", auth)).body.data).toEqual({ categories: [] })
        const response = await request(app).post(preview).set("Authorization", auth).set("Accept-Language", "en").send(input)
        expect(response.status).toBe(200)
        expect(response.body.data.totalCost).toBe(284)
        expect(previewAdminCatalogQuote).toHaveBeenCalledWith(expect.objectContaining(input), "en")
        expect(confirmCatalogQuote).not.toHaveBeenCalled()
        const invalid = await request(app).post(preview).set("Authorization", auth).send({ ...input, totalCost: 1 })
        expect(invalid.status).toBe(400)
        expect(previewAdminCatalogQuote).toHaveBeenCalledTimes(1)
    })
    it("does not authenticate or answer other paths of the shared /admin/quotes prefix", async () => {
        const response = await request(app).post("/api/admin/quotes/preview").send({})
        expect(response.status).toBe(404)
    })
})
