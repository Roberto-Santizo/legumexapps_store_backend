jest.mock("../../salesperson/services/representativeClient.service", () => ({ representativeClientService: { authorizedClientIds: jest.fn().mockResolvedValue([11, 12]) } }))
jest.mock("../../quoteOrder/services/representativeQuoteAccess.service", () => ({ requireRepresentativeVariantAccess: jest.fn().mockResolvedValue(undefined) }))

jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/fixedQuote.service", () => ({
    fixedQuoteService: {
        calculateQuote: jest.fn(),
        listQuotableProducts: jest.fn(),
        listQuoteDestinations: jest.fn(),
        saveQuote: jest.fn(),
        saveAdminQuote: jest.fn(),
        assertQuotesExist: jest.fn(),
        recordEmailDelivery: jest.fn(),
        listAllQuotes: jest.fn(),
    }
}))
jest.mock("../../quoteOrder/services/adminQuoteOrder.service", () => ({ resolveAdminQuoteOrder: jest.fn() }))
jest.mock("../../../shared/services/email.service", () => ({
    emailService: { sendMailWithAttachment: jest.fn() }
}))
jest.mock("../services/productionOrder.service", () => ({ listProductionOrders: jest.fn() }))
jest.mock("../../quoteDraft/services/quoteDraft.service", () => ({
    quoteDraftService: { upsertFromCalculation: jest.fn(), markConverted: jest.fn(), listDrafts: jest.fn() }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import adminQuoteRouter from "./adminQuote.routes"
import { fixedQuoteService as quoteService } from "../services/fixedQuote.service"
import { quoteDraftService } from "../../quoteDraft/services/quoteDraft.service"
import { emailService } from "../../../shared/services/email.service"
import { listProductionOrders } from "../services/productionOrder.service"
import { resolveAdminQuoteOrder } from "../../quoteOrder/services/adminQuoteOrder.service"

describe("production reports", () => {
    it("requires both read permissions before accessing mixed orders", async () => {
        for (const permissions of [[], ["quotes:view"], ["customQuotes:view"]]) {
            const response = await request(app).get("/api/admin/quotes/production-orders").set("Authorization", `Bearer ${staffToken(permissions)}`)
            expect(response.status).toBe(403)
        }
        expect(listProductionOrders).not.toHaveBeenCalled()
    })
    it("returns persisted orders and validates dates", async () => {
        ;(listProductionOrders as jest.Mock).mockResolvedValue([{ id: "order", lines: [] }])
        const auth = `Bearer ${staffToken(["quotes:view", "customQuotes:view"])}`
        const response = await request(app).get("/api/admin/quotes/production-orders?startDate=2026-10-08&endDate=2026-10-08").set("Authorization", auth)
        expect(response.status).toBe(200)
        expect(response.body.data).toEqual([{ id: "order", lines: [] }])
        expect(listProductionOrders).toHaveBeenCalledWith({ startDate: "2026-10-08", endDate: "2026-10-08" })
        const invalid = await request(app).get("/api/admin/quotes/production-orders?startDate=invalid").set("Authorization", auth)
        expect(invalid.status).toBe(400)
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

    describe("POST / -- guardar desde el cotizador del admin", () => {
        const orderId = "3f1c2b8e-9d4a-4c6b-8e2f-1a2b3c4d5e6f"
        const order = { id: orderId, clientId: 11, clientName: "Cliente real" }

        it("guarda a nombre del usuario staff con el cliente que resuelve el servidor", async () => {
            ;(resolveAdminQuoteOrder as jest.Mock).mockResolvedValue(order)
            ;(quoteService.saveAdminQuote as jest.Mock).mockResolvedValue({ id: 7, totalCost: 284 })

            const res = await request(app).post("/api/admin/quotes").set("Authorization", `Bearer ${staffToken(["quotes:calculate"])}`)
                .send({ ...validQuoteBody, orderId, order: { id: orderId, clientId: 99, clientName: "Inventado" }, draftKey: orderId })

            expect(res.status).toBe(201)
            expect(res.body.data).toEqual({ id: 7, totalCost: 284 })
            expect(resolveAdminQuoteOrder).toHaveBeenCalledWith(orderId, 10)
            // El order y el draftKey del navegador se descartan: el cliente sale del producto.
            expect(quoteService.saveAdminQuote).toHaveBeenCalledWith(1, { ...validQuoteBody, order }, "es")
            expect(quoteService.saveQuote).not.toHaveBeenCalled()
            expect(quoteDraftService.markConverted).not.toHaveBeenCalled()
        })

        it("exige quotes:calculate, token staff y un orderId válido", async () => {
            expect((await request(app).post("/api/admin/quotes").send({ ...validQuoteBody, orderId })).status).toBe(401)
            expect((await request(app).post("/api/admin/quotes").set("Authorization", `Bearer ${salespersonToken}`).send({ ...validQuoteBody, orderId })).status).toBe(401)
            expect((await request(app).post("/api/admin/quotes").set("Authorization", `Bearer ${staffToken(["quotes:view"])}`).send({ ...validQuoteBody, orderId })).status).toBe(403)
            expect((await request(app).post("/api/admin/quotes").set("Authorization", `Bearer ${staffToken(["quotes:calculate"])}`).send(validQuoteBody)).status).toBe(400)
            expect(quoteService.saveAdminQuote).not.toHaveBeenCalled()
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
            expect(quoteService.saveAdminQuote).not.toHaveBeenCalled()
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
            // Sin quoteIds (p. ej. detalle de una cotización a la medida) no se registra nada.
            expect(quoteService.recordEmailDelivery).not.toHaveBeenCalled()
        })

        const send = (token: string, fields: Record<string, string>) => {
            let req = request(app).post("/api/admin/quotes/send-email").set("Authorization", `Bearer ${token}`)
                .field("to", "compras@cliente.com").field("subject", "Cotización").field("body", "Hola")
            for (const [name, value] of Object.entries(fields)) req = req.field(name, value)
            return req.attach("file", Buffer.from("%PDF-1.4"), { filename: "cotizacion.pdf", contentType: "application/pdf" })
        }

        it("con quoteIds registra destinatario, correo, usuario y fecha después de enviar", async () => {
            (emailService.sendMailWithAttachment as jest.Mock).mockResolvedValue(undefined)
            ;(quoteService.assertQuotesExist as jest.Mock).mockResolvedValue(undefined)
            ;(quoteService.recordEmailDelivery as jest.Mock).mockResolvedValue(undefined)

            const res = await send(staffToken(["quotes:calculate"]), { recipientName: "  María Pérez ", quoteIds: "[7,8]" })

            expect(res.status).toBe(200)
            expect(quoteService.assertQuotesExist).toHaveBeenCalledWith([7, 8])
            expect(quoteService.recordEmailDelivery).toHaveBeenCalledWith([7, 8], {
                recipientName: "María Pérez", recipientEmail: "compras@cliente.com", sentByUserId: 1, sentAt: expect.any(String),
            })
            const order = (fn: unknown) => (fn as jest.Mock).mock.invocationCallOrder[0]
            expect(order(quoteService.assertQuotesExist)).toBeLessThan(order(emailService.sendMailWithAttachment))
            expect(order(emailService.sendMailWithAttachment)).toBeLessThan(order(quoteService.recordEmailDelivery))
        })

        it("no envía ni registra si una cotización no existe, ni registra si el correo falla", async () => {
            const token = staffToken(["quotes:calculate"])
            ;(quoteService.assertQuotesExist as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("missing"), { statusCode: 404 }))
            expect((await send(token, { recipientName: "María", quoteIds: "[7]" })).status).not.toBe(200)
            expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()

            ;(quoteService.assertQuotesExist as jest.Mock).mockResolvedValue(undefined)
            ;(emailService.sendMailWithAttachment as jest.Mock).mockRejectedValueOnce(new Error("smtp"))
            expect((await send(token, { recipientName: "María", quoteIds: "[7]" })).status).not.toBe(200)
            expect(quoteService.recordEmailDelivery).not.toHaveBeenCalled()
        })

        it("400 si llega solo uno de recipientName / quoteIds, o quoteIds inválidos", async () => {
            const token = staffToken(["quotes:calculate"])
            for (const fields of <Record<string, string>[]>[{ recipientName: "María" }, { quoteIds: "[7]" }, { recipientName: "María", quoteIds: "[7,7]" }, { recipientName: "María", quoteIds: "nope" }, { recipientName: " ", quoteIds: "[7]" }]) {
                expect((await send(token, fields)).status).toBe(400)
            }
            expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
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
