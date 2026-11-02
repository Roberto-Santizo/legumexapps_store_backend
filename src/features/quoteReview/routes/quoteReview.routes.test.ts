// Contrato HTTP de la revisión gerencial: quién entra a cada ruta y qué entrada se acepta. La lógica
// (huellas, bloqueos, precios) se prueba contra PostgreSQL real en database/application.postgres.test.ts.
jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret", jwtExpiresIn: "1h", quoteReviewRecipients: [] } }))
jest.mock("../services/quoteReview.service", () => ({
    quoteReviewService: {
        submitForReview: jest.fn(), getRepresentativeReview: jest.fn(), listReviews: jest.fn(), getReviewDetail: jest.fn(),
        previewReview: jest.fn(), approveReview: jest.fn(), rejectReview: jest.fn(), deliverReview: jest.fn(), resendNotification: jest.fn(), setAdminOrderPricing: jest.fn(),
    },
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import quoteReviewRouter from "./quoteReview.routes"
import adminQuoteReviewRouter from "./adminQuoteReview.routes"
import { quoteReviewService } from "../services/quoteReview.service"

const representativeApp = buildTestApp("/api/quote-reviews", quoteReviewRouter)
const adminApp = buildTestApp("/api/admin/quote-reviews", adminQuoteReviewRouter)
const representative = `Bearer ${jwt.sign({ sub: 42, type: "customer" }, "test-secret")}`
const staff = (permissions: string[]) => `Bearer ${jwt.sign({ sub: 7, type: "staff", roleId: 1, roleName: "Rol", permissions }, "test-secret")}`
const orderId = "72db466a-e594-48b7-9864-128b4b305b08"
const digest = "a".repeat(64)
const service = quoteReviewService as unknown as Record<string, jest.Mock>

beforeEach(() => {
    for (const mock of Object.values(service)) mock.mockReset().mockResolvedValue({ ok: true })
})

describe("representante (/quote-reviews)", () => {
    it("envía SU pedido con o sin correo del cliente: el id del representante sale del JWT, nunca del body", async () => {
        const submit = (body: object) => request(representativeApp).post(`/api/quote-reviews/${orderId}`).set("Authorization", representative).send(body)
        for (const body of [{ clientEmail: "no-es-correo" }, { clientEmail: "" }, { clientEmail: "compras@cliente.com", salespersonId: 99 }]) {
            expect((await submit(body)).status).toBe(400)
        }
        expect(service.submitForReview).not.toHaveBeenCalled()
        expect((await submit({ clientEmail: "  Compras@Cliente.com " })).status).toBe(201)
        expect(service.submitForReview).toHaveBeenCalledWith(42, orderId, "compras@cliente.com", expect.any(Function))
        // Sin correo también llega a gerencia (nunca un correo inventado).
        expect((await submit({})).status).toBe(201)
        expect(service.submitForReview).toHaveBeenLastCalledWith(42, orderId, undefined, expect.any(Function))
    })

    it("el representante no tiene rutas para aprobar, rechazar, fijar ganancia ni enviar", async () => {
        for (const path of ["approve", "reject", "delivery", "preview", "notify"]) {
            expect((await request(representativeApp).post(`/api/quote-reviews/${orderId}/${path}`).set("Authorization", representative).send({})).status).toBe(404)
        }
    })

    it("consulta el estado de su pedido", async () => {
        expect((await request(representativeApp).get(`/api/quote-reviews/${orderId}`).set("Authorization", representative)).status).toBe(200)
        expect(service.getRepresentativeReview).toHaveBeenCalledWith(42, orderId)
    })

    it("401 sin token o con un token de staff; 400 si el pedido no es un UUID", async () => {
        expect((await request(representativeApp).post(`/api/quote-reviews/${orderId}`)).status).toBe(401)
        expect((await request(representativeApp).post(`/api/quote-reviews/${orderId}`).set("Authorization", staff(["quotes:review"]))).status).toBe(401)
        expect((await request(representativeApp).post("/api/quote-reviews/no-es-uuid").set("Authorization", representative)).status).toBe(400)
        expect(service.submitForReview).not.toHaveBeenCalled()
    })
})

describe("gerencia (/admin/quote-reviews)", () => {
    // Cada fila con sus tres valores: con menos, it.each pasa su callback `done` en el lugar del body.
    const routes: [string, string, object][] = [
        ["get", "/", {}],
        ["get", `/${orderId}`, {}],
        ["post", `/${orderId}/preview`, { profitPerPound: "0.25" }],
        ["post", `/${orderId}/approve`, { profitPerPound: "0.25", linesDigest: digest, delivery: "none" }],
        ["post", `/${orderId}/reject`, { reason: "No contamos con el producto" }],
        ["post", `/${orderId}/notify`, {}],
    ]

    it.each(routes)("%s %s exige quotes:review: el representante y quotes:view/quotes:calculate no entran", async (method, path, body) => {
        const call = (authorization: string) => (request(adminApp) as any)[method](`/api/admin/quote-reviews${path}`).set("Authorization", authorization).send(body)
        expect((await call(representative)).status).toBe(401)
        expect((await call(staff(["quotes:view", "quotes:calculate"]))).status).toBe(403)
        expect((await call(staff(["quotes:review"]))).status).toBe(200)
    })

    it("aprobar exige el monto, la huella de las líneas revistas y la decisión de envío explícita; no acepta un precio", async () => {
        const approve = (body: object) => request(adminApp).post(`/api/admin/quote-reviews/${orderId}/approve`).set("Authorization", staff(["quotes:review"])).send(body)
        const valid = { profitPerPound: 0.25, linesDigest: digest, delivery: "none" }
        for (const body of [
            { profitPerPound: "0.25", linesDigest: digest }, // Sin decisión de envío: nunca se asume una.
            { ...valid, delivery: "client" },
            { ...valid, linesDigest: "corta" },
            { ...valid, finalPrice: 1 },
            { ...valid, profitPerPound: true },
            { ...valid, delivery: "representative_and_client", clientEmail: "no-es-correo" },
        ]) {
            expect((await approve(body)).status).toBe(400)
        }
        expect(service.approveReview).not.toHaveBeenCalled()
        expect((await approve(valid)).status).toBe(200)
        expect(service.approveReview).toHaveBeenCalledWith(orderId, valid, 7, undefined, expect.any(Function))
    })

    it("aprobar y enviar lleva el PDF final (multipart) y el correo del cliente opcional; rechaza otro tipo de archivo", async () => {
        const approve = () => request(adminApp).post(`/api/admin/quote-reviews/${orderId}/approve`).set("Authorization", staff(["quotes:review"]))
            .field("profitPerPound", "0.25").field("linesDigest", digest).field("delivery", "representative_and_client").field("clientEmail", " Compras@Cliente.com")
        expect((await approve().attach("file", Buffer.from("texto"), { filename: "nota.txt", contentType: "text/plain" })).status).toBe(422)
        expect(service.approveReview).not.toHaveBeenCalled()
        expect((await approve().attach("file", Buffer.from("%PDF-1.4"), { filename: "cotizacion.pdf", contentType: "application/pdf" })).status).toBe(200)
        expect(service.approveReview).toHaveBeenCalledWith(orderId, { profitPerPound: "0.25", linesDigest: digest, delivery: "representative_and_client", clientEmail: "compras@cliente.com" }, 7, { buffer: expect.any(Buffer), fileName: "cotizacion.pdf" }, expect.any(Function))
    })

    it("rechazar exige un motivo de al menos 5 caracteres", async () => {
        const reject = (body: object) => request(adminApp).post(`/api/admin/quote-reviews/${orderId}/reject`).set("Authorization", staff(["quotes:review"])).send(body)
        for (const body of [{}, { reason: "   " }, { reason: "no" }, { reason: "x".repeat(501) }, { reason: "No contamos con el producto", profitPerPound: 1 }]) {
            expect((await reject(body)).status).toBe(400)
        }
        expect(service.rejectReview).not.toHaveBeenCalled()
        expect((await reject({ reason: "  No contamos con el producto " })).status).toBe(200)
        expect(service.rejectReview).toHaveBeenCalledWith(orderId, "No contamos con el producto", 7, expect.any(Function))
    })

    it("el envío comercial exige quotes:review, los destinatarios y el PDF", async () => {
        const pdf = [Buffer.from("%PDF-1.4"), { filename: "c.pdf", contentType: "application/pdf" }] as const
        const deliver = (authorization: string) => request(adminApp).post(`/api/admin/quote-reviews/${orderId}/delivery`).set("Authorization", authorization)
        expect((await deliver(representative).field("recipients", "representative").attach("file", ...pdf)).status).toBe(401)
        expect((await deliver(staff(["quotes:view", "quotes:calculate"])).field("recipients", "representative").attach("file", ...pdf)).status).toBe(403)
        // Sin destinatarios, con otros desconocidos o con campos extra: no llega al servicio.
        expect((await deliver(staff(["quotes:review"])).attach("file", ...pdf)).status).toBe(400)
        expect((await deliver(staff(["quotes:review"])).field("recipients", "client").attach("file", ...pdf)).status).toBe(400)
        expect((await deliver(staff(["quotes:review"])).field("recipients", "representative").field("to", "otro@cliente.com").attach("file", ...pdf)).status).toBe(400)
        // Sin PDF.
        expect((await deliver(staff(["quotes:review"])).field("recipients", "representative")).status).toBe(422)
        expect(service.deliverReview).not.toHaveBeenCalled()
        expect((await deliver(staff(["quotes:review"])).field("recipients", "representative").field("clientEmail", "").attach("file", ...pdf)).status).toBe(200)
        expect(service.deliverReview).toHaveBeenCalledWith(orderId, { recipients: "representative" }, { buffer: expect.any(Buffer), fileName: "c.pdf" }, expect.any(Function))
    })

    it("la calculadora del admin fija su ganancia con quotes:calculate (sin revisión)", async () => {
        const price = (authorization: string) => request(adminApp).put(`/api/admin/quote-reviews/${orderId}/admin-pricing`).set("Authorization", authorization).send({ profitPerPound: 0.5 })
        expect((await price(staff(["quotes:view"]))).status).toBe(403)
        expect((await price(staff(["quotes:calculate"]))).status).toBe(200)
        expect(service.setAdminOrderPricing).toHaveBeenCalledWith(orderId, 0.5, 7)
    })

    it("400 con un estado de filtro desconocido", async () => {
        expect((await request(adminApp).get("/api/admin/quote-reviews?status=lost").set("Authorization", staff(["quotes:review"]))).status).toBe(400)
    })
})
