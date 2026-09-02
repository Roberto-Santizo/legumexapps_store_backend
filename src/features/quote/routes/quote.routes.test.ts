// Pruebas de contrato HTTP: levantan la app real (json -> i18n -> quoteRouter -> errorHandler)
// con supertest, sin tocar base de datos. Complementan a quote.service.test.ts -- ahí se
// prueba la matemática; acá se prueba que las rutas estén cableadas con el middleware
// correcto (auth, validate) y que errorHandler traduzca bien lo que tira el service.
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
jest.mock("../../../shared/services/exchangeRate.service", () => ({
    getUsdToGtqRate: jest.fn()
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import quoteRouter from "./quote.routes"
import { quoteService } from "../services/quote.service"
import { emailService } from "../../../shared/services/email.service"
import { getUsdToGtqRate } from "../../../shared/services/exchangeRate.service"
import { AppError } from "../../../shared/errors/AppError"

const app = buildTestApp("/api/quotes", quoteRouter)

const customerToken = jwt.sign({ sub: 42, type: "customer" }, "test-secret")
const staffToken = jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions: ["*"] }, "test-secret")

const validQuoteBody = { productVariantId: 10, destinationId: 900, requestedPallets: 1 }

describe("quoteRouter (HTTP)", () => {
    describe("autenticación", () => {
        it("rechaza cualquier ruta sin Authorization con 401", async () => {
            const res = await request(app).get("/api/quotes/products")
            expect(res.status).toBe(401)
        })

        it("rechaza un token de staff en una ruta de cliente con 401", async () => {
            const res = await request(app).get("/api/quotes/products").set("Authorization", `Bearer ${staffToken}`)
            expect(res.status).toBe(401)
        })
    })

    describe("GET /products y /destinations", () => {
        it("200 con la lista que devuelve el service, para un token de cliente válido", async () => {
            (quoteService.listQuotableProducts as jest.Mock).mockResolvedValue([{ id: 1, displayName: "Piña" }])

            const res = await request(app).get("/api/quotes/products").set("Authorization", `Bearer ${customerToken}`)

            expect(res.status).toBe(200)
            expect(res.body).toEqual({ data: [{ id: 1, displayName: "Piña" }] })
        })
    })

    describe("POST / (calcular y guardar)", () => {
        it("400 con detalle de campos si el body no pasa el schema (nunca llega a tocar el service)", async () => {
            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${customerToken}`)
                .send({ requestedPallets: 0 }) // faltan productVariantId/destinationId, y 0 < mínimo de 1 palet

            expect(res.status).toBe(400)
            expect(Array.isArray(res.body.details)).toBe(true)
            expect(quoteService.saveQuote).not.toHaveBeenCalled()
        })

        it("201 al guardar, usando el id del cliente autenticado (no uno que mande el body)", async () => {
            (quoteService.saveQuote as jest.Mock).mockResolvedValue({ id: 5, totalCost: 284 })

            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${customerToken}`)
                .send({ ...validQuoteBody, customerId: 999 }) // intento de suplantar a otro cliente

            expect(res.status).toBe(201)
            expect(res.body.data).toEqual({ id: 5, totalCost: 284 })
            // 42 viene del JWT (customerToken), no del 999 que mandó el body -- customerId ni
            // siquiera es un campo del schema, así que zod ya lo habría descartado igual. El
            // tercer argumento es el idioma resuelto de Accept-Language (ver
            // shared/utils/translation.util.ts) -- este request no lo manda, cae al fallback "es".
            expect(quoteService.saveQuote).toHaveBeenCalledWith(42, validQuoteBody, "es")
        })

        it("traduce un AppError del service al statusCode y mensaje en español correctos", async () => {
            (quoteService.saveQuote as jest.Mock).mockRejectedValue(new AppError(422, "errors.pallet_not_configured"))

            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${customerToken}`)
                .send(validQuoteBody)

            expect(res.status).toBe(422)
            expect(res.body.message).toBe("La presentación seleccionada no tiene definidas las unidades por palet. Contacta al administrador para configurarla.")
        })

        it("un error inesperado del service no filtra detalles internos (500 genérico)", async () => {
            (quoteService.saveQuote as jest.Mock).mockRejectedValue(new Error("connection reset by peer at 10.0.4.2:5432"))
            const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${customerToken}`)
                .send(validQuoteBody)

            expect(res.status).toBe(500)
            expect(JSON.stringify(res.body)).not.toContain("10.0.4.2")
            consoleErrorSpy.mockRestore()
        })
    })

    describe("GET /exchange-rate", () => {
        it("200 con el tipo de cambio que devuelve el service, para un token de cliente válido", async () => {
            (getUsdToGtqRate as jest.Mock).mockResolvedValue(7.8)

            const res = await request(app).get("/api/quotes/exchange-rate").set("Authorization", `Bearer ${customerToken}`)

            expect(res.status).toBe(200)
            expect(res.body).toEqual({ data: { rate: 7.8 } })
        })

        it("rechaza sin token de cliente, igual que el resto de rutas de quoteRouter", async () => {
            const res = await request(app).get("/api/quotes/exchange-rate")
            expect(res.status).toBe(401)
        })

        it("503 con mensaje claro si Banguat falla y no hay cache (nunca 500 genérico)", async () => {
            (getUsdToGtqRate as jest.Mock).mockRejectedValue(new Error("timeout"))

            const res = await request(app).get("/api/quotes/exchange-rate").set("Authorization", `Bearer ${customerToken}`)

            expect(res.status).toBe(503)
            expect(res.body.message).toBe("No se pudo obtener el tipo de cambio en este momento. Intenta de nuevo más tarde.")
        })
    })

    describe("POST /send-email (adjuntar y enviar el PDF ya generado por el front)", () => {
        it("422 si no viene ningún archivo adjunto", async () => {
            const res = await request(app)
                .post("/api/quotes/send-email")
                .set("Authorization", `Bearer ${customerToken}`)
                .field("to", "cliente@empresa.com")
                .field("subject", "Cotización")
                .field("body", "Hola, adjunto la cotización.")

            expect(res.status).toBe(422)
            expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
        })

        it("422 si el archivo adjunto no es un PDF", async () => {
            const res = await request(app)
                .post("/api/quotes/send-email")
                .set("Authorization", `Bearer ${customerToken}`)
                .field("to", "cliente@empresa.com")
                .field("subject", "Cotización")
                .field("body", "Hola")
                .attach("file", Buffer.from("no soy un pdf"), { filename: "cotizacion.txt", contentType: "text/plain" })

            expect(res.status).toBe(422)
            expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
        })

        it("400 si el email del destinatario no es válido -- nunca llega a intentar el envío", async () => {
            const res = await request(app)
                .post("/api/quotes/send-email")
                .set("Authorization", `Bearer ${customerToken}`)
                .field("to", "no-es-un-email")
                .field("subject", "Cotización")
                .field("body", "Hola")
                .attach("file", Buffer.from("%PDF-1.4"), { filename: "cotizacion.pdf", contentType: "application/pdf" })

            expect(res.status).toBe(400)
            expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
        })

        it("200 y reenvía el PDF adjunto con los datos exactos del multipart -- caso feliz", async () => {
            (emailService.sendMailWithAttachment as jest.Mock).mockResolvedValue(undefined)
            const pdfContent = Buffer.from("%PDF-1.4 contenido de prueba")

            const res = await request(app)
                .post("/api/quotes/send-email")
                .set("Authorization", `Bearer ${customerToken}`)
                .field("to", "cliente@empresa.com")
                .field("subject", "Cotización para Cliente Uno")
                .field("body", "Hola, adjunto la cotización.")
                .attach("file", pdfContent, { filename: "cotizacion.pdf", contentType: "application/pdf" })

            expect(res.status).toBe(200)
            expect(emailService.sendMailWithAttachment).toHaveBeenCalledWith({
                to: "cliente@empresa.com",
                subject: "Cotización para Cliente Uno",
                textBody: "Hola, adjunto la cotización.",
                attachment: {
                    buffer: pdfContent,
                    fileName: "cotizacion.pdf",
                    contentType: "application/pdf"
                }
            })
        })

        it("rechaza sin token de cliente, igual que el resto de rutas de quoteRouter", async () => {
            const res = await request(app)
                .post("/api/quotes/send-email")
                .field("to", "cliente@empresa.com")
                .field("subject", "Cotización")
                .field("body", "Hola")
                .attach("file", Buffer.from("%PDF-1.4"), { filename: "cotizacion.pdf", contentType: "application/pdf" })

            expect(res.status).toBe(401)
            expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
        })
    })
})
