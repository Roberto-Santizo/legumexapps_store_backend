
jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
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

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import adminQuoteRouter from "./adminQuote.routes"
import { quoteService } from "../services/quote.service"
import { emailService } from "../../../shared/services/email.service"

const app = buildTestApp("/api/admin/quotes", adminQuoteRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

const customerToken = jwt.sign({ sub: 42, type: "customer" }, "test-secret")
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
                .set("Authorization", `Bearer ${customerToken}`)
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
