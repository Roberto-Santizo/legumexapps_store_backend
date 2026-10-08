
jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../../customQuote/services/catalogQuoteDiscovery.service", () => ({ discoverCatalog: jest.fn() }))
jest.mock("../../customQuote/services/catalogQuote.service", () => ({ previewAdminCatalogQuote: jest.fn(), confirmCatalogQuote: jest.fn() }))
jest.mock("../services/quote.service", () => ({
    quoteService: {
        calculateQuote: jest.fn(),
        listQuotableProducts: jest.fn(),
        listQuoteDestinations: jest.fn(),
        saveQuote: jest.fn(),
        listAllQuotes: jest.fn(),
    }
}))
jest.mock("../../../shared/services/email.service", () => ({
    emailService: { sendMailWithAttachment: jest.fn() }
}))
jest.mock("../../quoteDraft/services/quoteDraft.service", () => ({
    quoteDraftService: { upsertFromCalculation: jest.fn(), markConverted: jest.fn(), listDrafts: jest.fn() }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import adminQuoteRouter from "./adminQuote.routes"
import { quoteService } from "../services/quote.service"
import { quoteDraftService } from "../../quoteDraft/services/quoteDraft.service"
import { emailService } from "../../../shared/services/email.service"
import { discoverCatalog } from "../../customQuote/services/catalogQuoteDiscovery.service"
import { previewAdminCatalogQuote, confirmCatalogQuote } from "../../customQuote/services/catalogQuote.service"

describe("admin customizable calculator", () => {
    const input = { categoryId: 1, subCategoryId: 3, configurationId: 5, ingredientType: "fruit", isOrganic: false, requestedPallets: 2, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }] }
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
    it("discovers and calculates without customer confirmation or quote/draft writes", async () => {
        const auth = `Bearer ${staffToken(["quotes:calculate"])}`
        ;(discoverCatalog as jest.Mock).mockResolvedValue({ categories: [] })
        ;(previewAdminCatalogQuote as jest.Mock).mockResolvedValue({ totalCost: 284, requestedPallets: 2 })
        expect((await request(app).get(catalog).set("Authorization", auth)).body.data).toEqual({ categories: [] })
        const response = await request(app).post(preview).set("Authorization", auth).set("Accept-Language", "en").send(input)
        expect(response.status).toBe(200)
        expect(response.body.data.totalCost).toBe(284)
        expect(previewAdminCatalogQuote).toHaveBeenCalledWith(expect.objectContaining(input), "en")
        expect(confirmCatalogQuote).not.toHaveBeenCalled()
        expect(quoteService.saveQuote).not.toHaveBeenCalled()
        expect(quoteDraftService.upsertFromCalculation).not.toHaveBeenCalled()
        const invalid = await request(app).post(preview).set("Authorization", auth).send({ ...input, totalCost: 1 })
        expect(invalid.status).toBe(400)
        expect(previewAdminCatalogQuote).toHaveBeenCalledTimes(1)
    })
})

const app = buildTestApp("/api/admin/quotes", adminQuoteRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

const salespersonToken = jwt.sign({ sub: 42, type: "customer" }, "test-secret")
const validQuoteBody = { productVariantId: 10, destinationId: 900, requestedPallets: 1 }

describe("adminQuoteRouter (HTTP) -- cotizador interno del admin", () => {
    describe("autenticación y permisos", () => {
        it("rechaza sin Authorization con 401", async () => {
            const res = await request(app).post("/api/admin/quotes/preview").send(validQuoteBody)
            expect(res.status).toBe(401)
        })

        it("rechaza un token de cliente (type customer) con 401 -- este router es solo para staff", async () => {
            const res = await request(app)
                .post("/api/admin/quotes/preview")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send(validQuoteBody)
            expect(res.status).toBe(401)
        })

        it("rechaza a un staff SIN el permiso \"quotes:calculate\" con 403, aunque tenga \"quotes:view\"", async () => {
            const token = staffToken(["quotes:view"])

            const previewRes = await request(app).post("/api/admin/quotes/preview").set("Authorization", `Bearer ${token}`).send(validQuoteBody)
            const productsRes = await request(app).get("/api/admin/quotes/products").set("Authorization", `Bearer ${token}`)
            const destinationsRes = await request(app).get("/api/admin/quotes/destinations").set("Authorization", `Bearer ${token}`)

            expect(previewRes.status).toBe(403)
            expect(productsRes.status).toBe(403)
            expect(destinationsRes.status).toBe(403)
            expect(quoteService.calculateQuote).not.toHaveBeenCalled()
        })
    })

    describe("GET /products y /destinations (con \"quotes:calculate\")", () => {
        it("200 con la lista que devuelve el service", async () => {
            (quoteService.listQuotableProducts as jest.Mock).mockResolvedValue([{ id: 1, displayName: "Piña" }])
            const token = staffToken(["quotes:calculate"])

            const res = await request(app).get("/api/admin/quotes/products").set("Authorization", `Bearer ${token}`)

            expect(res.status).toBe(200)
            expect(res.body).toEqual({ data: [{ id: 1, displayName: "Piña" }] })
        })
    })

    describe("POST /preview -- garantía central: calcula pero NUNCA guarda", () => {
        it("200 con el desglose calculado, y jamás llama a saveQuote", async () => {
            (quoteService.calculateQuote as jest.Mock).mockResolvedValue({ totalCost: 284, breakdown: { rawMaterials: [] } })
            const token = staffToken(["quotes:calculate"])

            const res = await request(app).post("/api/admin/quotes/preview").set("Authorization", `Bearer ${token}`).send(validQuoteBody)

            expect(res.status).toBe(200)
            expect(res.body).toEqual({ data: { totalCost: 284, breakdown: { rawMaterials: [] } } })
            expect(quoteService.calculateQuote).toHaveBeenCalledWith(validQuoteBody, "es")
            expect(quoteService.saveQuote).not.toHaveBeenCalled()
        })

        it("nunca escribe un borrador (cotización sin finalizar), aunque el body traiga un draftKey", async () => {
            (quoteService.calculateQuote as jest.Mock).mockResolvedValue({ totalCost: 284 })
            const token = staffToken(["quotes:calculate"])

            const res = await request(app)
                .post("/api/admin/quotes/preview")
                .set("Authorization", `Bearer ${token}`)
                .send({ ...validQuoteBody, draftKey: "3f1c2b8e-9d4a-4c6b-8e2f-1a2b3c4d5e6f" })

            expect(res.status).toBe(200)
            // calculateQuoteSchema (admin) no conoce draftKey: zod lo descarta antes del service.
            expect(quoteService.calculateQuote).toHaveBeenCalledWith(validQuoteBody, "es")
            expect(quoteDraftService.upsertFromCalculation).not.toHaveBeenCalled()
            expect(quoteDraftService.markConverted).not.toHaveBeenCalled()
            expect(quoteService.saveQuote).not.toHaveBeenCalled()
        })

        it("400 con detalle de campos si el body no pasa el schema (nunca llega a tocar el service)", async () => {
            const token = staffToken(["quotes:calculate"])

            const res = await request(app)
                .post("/api/admin/quotes/preview")
                .set("Authorization", `Bearer ${token}`)
                .send({ requestedPallets: 0 })

            expect(res.status).toBe(400)
            expect(quoteService.calculateQuote).not.toHaveBeenCalled()
        })
    })

    describe("GET / (listado real de cotizaciones de clientes) sigue exigiendo \"quotes:view\", no \"quotes:calculate\"", () => {
        it("403 para un staff que solo tiene \"quotes:calculate\"", async () => {
            const token = staffToken(["quotes:calculate"])

            const res = await request(app).get("/api/admin/quotes").set("Authorization", `Bearer ${token}`)

            expect(res.status).toBe(403)
        })
    })

    describe("POST /send-email (mismo endpoint que el del cliente, protegido con \"quotes:calculate\")", () => {
        it("403 para un staff sin \"quotes:calculate\", aunque tenga \"quotes:view\"", async () => {
            const token = staffToken(["quotes:view"])

            const res = await request(app)
                .post("/api/admin/quotes/send-email")
                .set("Authorization", `Bearer ${token}`)
                .field("to", "cliente@empresa.com")
                .field("subject", "Cotización")
                .field("body", "Hola")
                .attach("file", Buffer.from("%PDF-1.4"), { filename: "cotizacion.pdf", contentType: "application/pdf" })

            expect(res.status).toBe(403)
            expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
        })

        it("200 y reenvía el PDF adjunto para un staff con \"quotes:calculate\"", async () => {
            (emailService.sendMailWithAttachment as jest.Mock).mockResolvedValue(undefined)
            const token = staffToken(["quotes:calculate"])
            const pdfContent = Buffer.from("%PDF-1.4 contenido de prueba")

            const res = await request(app)
                .post("/api/admin/quotes/send-email")
                .set("Authorization", `Bearer ${token}`)
                .field("to", "cliente@empresa.com")
                .field("subject", "Cotización interna")
                .field("body", "Hola, adjunto la cotización.")
                .attach("file", pdfContent, { filename: "cotizacion.pdf", contentType: "application/pdf" })

            expect(res.status).toBe(200)
            expect(emailService.sendMailWithAttachment).toHaveBeenCalledWith({
                to: "cliente@empresa.com",
                subject: "Cotización interna",
                textBody: "Hola, adjunto la cotización.",
                attachment: { buffer: pdfContent, fileName: "cotizacion.pdf", contentType: "application/pdf" }
            })
        })
    })
})

describe("GET fixed quotes date filtering", () => {
    beforeEach(() => (quoteService.listAllQuotes as jest.Mock).mockClear().mockResolvedValue([]))
    it("forwards validated dates to the existing listing service", async () => {
        const response = await request(app).get("/api/admin/quotes?startDate=2026-10-01&endDate=2026-10-07").set("Authorization", `Bearer ${staffToken(["quotes:view"])}`)
        expect(response.status).toBe(200)
        expect(quoteService.listAllQuotes).toHaveBeenCalledWith({ startDate: "2026-10-01", endDate: "2026-10-07" })
    })
    it.each(["startDate=2026-10-08&endDate=2026-10-07", "startDate=2026-02-30", "endDate=2026-10-07T00:00:00Z"])("rejects invalid ranges before querying: %s", async query => {
        const response = await request(app).get(`/api/admin/quotes?${query}`).set("Authorization", `Bearer ${staffToken(["quotes:view"])}`)
        expect(response.status).toBe(400)
        expect(quoteService.listAllQuotes).not.toHaveBeenCalled()
    })
})
