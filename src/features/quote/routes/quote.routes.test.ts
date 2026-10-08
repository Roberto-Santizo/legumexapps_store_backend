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
jest.mock("../../quoteDraft/services/quoteDraft.service", () => ({
    quoteDraftService: { upsertFromCalculation: jest.fn(), markConverted: jest.fn(), listDrafts: jest.fn() }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import quoteRouter from "./quote.routes"
import { quoteService } from "../services/quote.service"
import { quoteDraftService } from "../../quoteDraft/services/quoteDraft.service"
import { emailService } from "../../../shared/services/email.service"
import { AppError } from "../../../shared/errors/AppError"

const app = buildTestApp("/api/quotes", quoteRouter)

// type se queda literal "customer" a propósito para no invalidar sesiones existentes (ver
// authenticateSalesperson.ts).
const salespersonToken = jwt.sign({ sub: 42, type: "customer" }, "test-secret")
const staffToken = jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions: ["*"] }, "test-secret")

const validQuoteBody = {
    productVariantId: 10,
    destinationId: 900,
    requestedPallets: 1,
}

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

            const res = await request(app).get("/api/quotes/products").set("Authorization", `Bearer ${salespersonToken}`)

            expect(res.status).toBe(200)
            expect(res.body).toEqual({ data: [{ id: 1, displayName: "Piña" }] })
        })
    })

    describe("POST / (calcular y guardar)", () => {
        it("400 con detalle de campos si el body no pasa el schema (nunca llega a tocar el service)", async () => {
            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ requestedPallets: 0 }) // falta productVariantId (destinationId ya es opcional), y 0 < mínimo de 1 palet

            expect(res.status).toBe(400)
            expect(Array.isArray(res.body.details)).toBe(true)
            expect(quoteService.saveQuote).not.toHaveBeenCalled()
        })

        it("201 sin ningún dato de prospecto -- guardar ya no exige leadContact (2026-09-21, desacople Quote <-> Lead)", async () => {
            (quoteService.saveQuote as jest.Mock).mockResolvedValue({ id: 6, totalCost: 100 })

            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ productVariantId: 10, requestedPallets: 1 })

            expect(res.status).toBe(201)
            expect(quoteService.saveQuote).toHaveBeenCalledWith(42, { productVariantId: 10, requestedPallets: 1 }, "es")
        })

        it("un leadContact/leadId que llegue en el body se descarta -- nunca se reenvía al service", async () => {
            (quoteService.saveQuote as jest.Mock).mockResolvedValue({ id: 7, totalCost: 100 })

            await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ ...validQuoteBody, leadId: 5, leadContact: { fullName: "Juan", companyName: "X", email: "juan@example.com" } })

            expect(quoteService.saveQuote).toHaveBeenCalledWith(42, validQuoteBody, "es")
        })

        it("201 al guardar, usando el id del cliente autenticado (no uno que mande el body)", async () => {
            (quoteService.saveQuote as jest.Mock).mockResolvedValue({ id: 5, totalCost: 284 })

            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ ...validQuoteBody, salespersonId: 999 }) // intento de suplantar a otro representante

            expect(res.status).toBe(201)
            expect(res.body.data).toEqual({ id: 5, totalCost: 284 })
            // 42 viene del JWT (salespersonToken), no del 999 que mandó el body -- salespersonId ni
            // siquiera es un campo del schema, así que zod ya lo habría descartado igual. El
            // tercer argumento es el idioma resuelto de Accept-Language (ver
            // shared/utils/translation.util.ts) -- este request no lo manda, cae al fallback "es".
            expect(quoteService.saveQuote).toHaveBeenCalledWith(42, validQuoteBody, "es")
        })

        it("201 y reenvía al service las selecciones de materiales por nivel (arrays, un id por grupo -- 2026-09-24)", async () => {
            (quoteService.saveQuote as jest.Mock).mockResolvedValue({ id: 6, totalCost: 300 })
            const body = {
                productVariantId: 10,
                requestedPallets: 2,
                selectedUnitMaterialIds: [502],
                selectedIntermediateMaterialIds: [],
                selectedPalletMaterialIds: [601, 604],
            }

            const res = await request(app).post("/api/quotes").set("Authorization", `Bearer ${salespersonToken}`).send(body)

            expect(res.status).toBe(201)
            expect(quoteService.saveQuote).toHaveBeenCalledWith(42, body, "es")
        })

        it("400 si una selección de materiales no es un array de ids (contrato por nivel, no un id suelto)", async () => {
            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ ...validQuoteBody, selectedPalletMaterialIds: 601 })

            expect(res.status).toBe(400)
            expect(quoteService.saveQuote).not.toHaveBeenCalled()
        })

        it("los campos viejos de id único (selectedXMaterialId) ya no existen en el contrato -- se descartan, nunca llegan al service", async () => {
            (quoteService.saveQuote as jest.Mock).mockResolvedValue({ id: 7, totalCost: 1 })

            await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ ...validQuoteBody, selectedPalletMaterialId: 601 })

            expect(quoteService.saveQuote).toHaveBeenCalledWith(42, validQuoteBody, "es")
        })

        it("traduce un AppError del service al statusCode y mensaje en español correctos", async () => {
            (quoteService.saveQuote as jest.Mock).mockRejectedValue(new AppError(422, "errors.pallet_not_configured"))

            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send(validQuoteBody)

            expect(res.status).toBe(422)
            expect(res.body.message).toBe("La presentación seleccionada no tiene definidas las unidades por palet. Contacta al administrador para configurarla.")
        })

        it("un error inesperado del service no filtra detalles internos (500 genérico)", async () => {
            (quoteService.saveQuote as jest.Mock).mockRejectedValue(new Error("connection reset by peer at 10.0.4.2:5432"))
            const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send(validQuoteBody)

            expect(res.status).toBe(500)
            expect(JSON.stringify(res.body)).not.toContain("10.0.4.2")
            consoleErrorSpy.mockRestore()
        })
    })

    describe("POST /preview -- recalculo en vivo: calcula pero NUNCA guarda", () => {
        it("200 con el cálculo del service, y jamás llama a saveQuote -- mismo contrato que /admin/quotes/preview", async () => {
            (quoteService.calculateQuote as jest.Mock).mockResolvedValue({ totalCost: 284 })

            const res = await request(app)
                .post("/api/quotes/preview")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ productVariantId: 10, requestedPallets: 1 })

            expect(res.status).toBe(200)
            expect(res.body).toEqual({ data: { totalCost: 284 } })
            expect(quoteService.saveQuote).not.toHaveBeenCalled()
        })

        it("es solo un cálculo -- nada se persiste, y tampoco acepta ni necesita datos de prospecto", async () => {
            (quoteService.calculateQuote as jest.Mock).mockResolvedValue({ totalCost: 100 })

            const res = await request(app)
                .post("/api/quotes/preview")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ productVariantId: 10, requestedPallets: 1 })

            expect(res.status).toBe(200)
        })

        it("acepta las selecciones de materiales por nivel (arrays) y se las pasa tal cual a calculateQuote", async () => {
            (quoteService.calculateQuote as jest.Mock).mockResolvedValue({ totalCost: 150 })
            const body = { productVariantId: 10, requestedPallets: 1, selectedUnitMaterialIds: [501, 504], selectedPalletMaterialIds: [604] }

            const res = await request(app).post("/api/quotes/preview").set("Authorization", `Bearer ${salespersonToken}`).send(body)

            expect(res.status).toBe(200)
            expect(quoteService.calculateQuote).toHaveBeenCalledWith(body, "es")
            expect(quoteService.saveQuote).not.toHaveBeenCalled()
        })

        it("rechaza sin token de cliente, igual que el resto de rutas de quoteRouter", async () => {
            const res = await request(app)
                .post("/api/quotes/preview")
                .send({ productVariantId: 10, requestedPallets: 1 })

            expect(res.status).toBe(401)
            expect(quoteService.calculateQuote).not.toHaveBeenCalled()
        })
    })

    describe("borradores (cotizaciones sin finalizar) -- draftKey", () => {
        const DRAFT_KEY = "3f1c2b8e-9d4a-4c6b-8e2f-1a2b3c4d5e6f"
        const calcBody = { productVariantId: 10, requestedPallets: 2, selectedPalletMaterialIds: [601] }

        beforeEach(() => {
            (quoteDraftService.upsertFromCalculation as jest.Mock).mockReset();
            (quoteService.calculateQuote as jest.Mock).mockReset()
        })

        it("preview con draftKey: calcula sin la clave y DESPUÉS registra el borrador del representante del JWT", async () => {
            const calculation = { productVariantId: 10, totalCost: 284 };
            (quoteService.calculateQuote as jest.Mock).mockResolvedValue(calculation);
            (quoteDraftService.upsertFromCalculation as jest.Mock).mockResolvedValue(undefined)

            const res = await request(app)
                .post("/api/quotes/preview")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ ...calcBody, draftKey: DRAFT_KEY })

            expect(res.status).toBe(200)
            expect(res.body).toEqual({ data: calculation }) // misma respuesta que sin borrador
            expect(quoteService.calculateQuote).toHaveBeenCalledWith(calcBody, "es")
            expect(quoteDraftService.upsertFromCalculation).toHaveBeenCalledWith(42, DRAFT_KEY, calcBody, calculation)
            const calcOrder = (quoteService.calculateQuote as jest.Mock).mock.invocationCallOrder[0]
            const draftOrder = (quoteDraftService.upsertFromCalculation as jest.Mock).mock.invocationCallOrder[0]
            expect(calcOrder).toBeLessThan(draftOrder)
            expect(quoteService.saveQuote).not.toHaveBeenCalled()
        })

        it("un cálculo que falla no escribe ningún borrador (sin borradores para configs inválidas)", async () => {
            (quoteService.calculateQuote as jest.Mock).mockRejectedValue(new AppError(422, "errors.pallet_not_configured"))

            const res = await request(app)
                .post("/api/quotes/preview")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ ...calcBody, draftKey: DRAFT_KEY })

            expect(res.status).toBe(422)
            expect(quoteDraftService.upsertFromCalculation).not.toHaveBeenCalled()
        })

        it("preview sin draftKey (frontend viejo) no escribe nada", async () => {
            (quoteService.calculateQuote as jest.Mock).mockResolvedValue({ totalCost: 1 })

            const res = await request(app)
                .post("/api/quotes/preview")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send(calcBody)

            expect(res.status).toBe(200)
            expect(quoteDraftService.upsertFromCalculation).not.toHaveBeenCalled()
        })

        it("si la escritura del borrador falla, igual devuelve 200 con el cálculo (el total en vivo nunca se rompe)", async () => {
            (quoteService.calculateQuote as jest.Mock).mockResolvedValue({ totalCost: 284 });
            (quoteDraftService.upsertFromCalculation as jest.Mock).mockRejectedValue(new Error("db down"))
            const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

            const res = await request(app)
                .post("/api/quotes/preview")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ ...calcBody, draftKey: DRAFT_KEY })

            expect(res.status).toBe(200)
            expect(res.body).toEqual({ data: { totalCost: 284 } })
            consoleErrorSpy.mockRestore()
        })

        it("400 si draftKey no es un UUID -- nunca calcula ni escribe", async () => {
            const res = await request(app)
                .post("/api/quotes/preview")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ ...calcBody, draftKey: "no-es-uuid" })

            expect(res.status).toBe(400)
            expect(quoteService.calculateQuote).not.toHaveBeenCalled()
            expect(quoteDraftService.upsertFromCalculation).not.toHaveBeenCalled()
        })

        it("guardar reenvía el draftKey al service (que marca el borrador convertido)", async () => {
            (quoteService.saveQuote as jest.Mock).mockResolvedValue({ id: 9, totalCost: 284 })

            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send({ ...calcBody, draftKey: DRAFT_KEY })

            expect(res.status).toBe(201)
            expect(quoteService.saveQuote).toHaveBeenCalledWith(42, { ...calcBody, draftKey: DRAFT_KEY }, "es")
        })

        it("guardar sin draftKey se comporta igual que antes (el body llega sin la clave)", async () => {
            (quoteService.saveQuote as jest.Mock).mockResolvedValue({ id: 10, totalCost: 284 })

            const res = await request(app)
                .post("/api/quotes")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .send(calcBody)

            expect(res.status).toBe(201)
            expect(quoteService.saveQuote).toHaveBeenCalledWith(42, calcBody, "es")
            expect((quoteService.saveQuote as jest.Mock).mock.calls[0][1]).not.toHaveProperty("draftKey")
        })
    })

    describe("POST /send-email (adjuntar y enviar el PDF ya generado por el front)", () => {
        it("422 si no viene ningún archivo adjunto", async () => {
            const res = await request(app)
                .post("/api/quotes/send-email")
                .set("Authorization", `Bearer ${salespersonToken}`)
                .field("to", "cliente@empresa.com")
                .field("subject", "Cotización")
                .field("body", "Hola, adjunto la cotización.")

            expect(res.status).toBe(422)
            expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
        })

        it("422 si el archivo adjunto no es un PDF", async () => {
            const res = await request(app)
                .post("/api/quotes/send-email")
                .set("Authorization", `Bearer ${salespersonToken}`)
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
                .set("Authorization", `Bearer ${salespersonToken}`)
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
                .set("Authorization", `Bearer ${salespersonToken}`)
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
