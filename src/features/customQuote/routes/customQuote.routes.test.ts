jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" } }))
jest.mock("../services/catalogQuoteDiscovery.service", () => ({ discoverCatalog: jest.fn() }))
jest.mock("../services/catalogQuote.service", () => ({ previewCatalogQuote: jest.fn(), confirmCatalogQuote: jest.fn() }))

import request from "supertest"
import jwt from "jsonwebtoken"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./customQuote.routes"
import { discoverCatalog } from "../services/catalogQuoteDiscovery.service"
import { previewCatalogQuote, confirmCatalogQuote } from "../services/catalogQuote.service"

const app = buildTestApp("/api/custom-quotes", router)
const authorization = `Bearer ${jwt.sign({ sub: 42, type: "customer" }, "test-secret")}`

it.each([
    ["get", "/api/custom-quotes/catalog"],
    ["post", "/api/custom-quotes/preview"],
    ["post", "/api/custom-quotes"],
] as const)("retired legacy endpoint %s %s cannot read options or create quotes", async (method, url) => {
    const call = method === "get" ? request(app).get(url) : request(app).post(url).send({ requestedPallets: 1 })
    const response = await call.set("Authorization", authorization)
    expect(response.status).toBe(404)
    expect(discoverCatalog).not.toHaveBeenCalled()
    expect(previewCatalogQuote).not.toHaveBeenCalled()
    expect(confirmCatalogQuote).not.toHaveBeenCalled()
})

it("the main router no longer mounts the exclusive legacy administration", () => {
    const source = readFileSync(resolve(__dirname, "../../../routes/index.ts"), "utf8")
    expect(source).not.toContain("customQuoteConfigRouter")
    expect(source).not.toContain('"/admin/custom-quote-config"')
    expect(source).toContain('appRouter.use("/custom-quotes", customQuoteRouter)')
    expect(source).toContain('appRouter.use("/admin/custom-quotes", adminCustomQuoteRouter)')
})
