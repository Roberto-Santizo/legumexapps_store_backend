import "reflect-metadata"

const mockEnv = { frontendUrl: "https://admin.example.invalid", quoteReviewRecipients: ["review@example.invalid"] as string[] }
jest.mock("../../../config/env", () => ({ env: mockEnv }))
jest.mock("../../../shared/services/email.service", () => ({ emailService: { sendMail: jest.fn() } }))
jest.mock("../models/QuoteOrderReview.model", () => ({
    __esModule: true,
    default: { update: jest.fn(), sequelize: { literal: (sql: string) => ({ sql }) } },
}))

jest.mock("../../salesperson/models/Salesperson.model", () => ({ __esModule: true, default: { findByPk: jest.fn() } }))

import QuoteOrderReview from "../models/QuoteOrderReview.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import { emailService } from "../../../shared/services/email.service"
import { notifyQuoteReview, notifyRepresentativeOfDecision } from "./quoteReviewNotification"

const sendMail = emailService.sendMail as jest.Mock
const update = QuoteOrderReview.update as unknown as jest.Mock
const review = { id: 3, orderId: "72db466a-e594-48b7-9864-128b4b305b08", clientName: "Walmart" } as unknown as QuoteOrderReview
const t = (key: string, values: Record<string, unknown> = {}) => `${key} ${JSON.stringify(values)}`

beforeEach(() => {
    sendMail.mockReset(); update.mockReset()
    mockEnv.quoteReviewRecipients = ["review@example.invalid"]
})

describe("notifyQuoteReview", () => {
    it("avisa a los destinatarios configurados con el enlace al admin, sin ningún monto, y registra el envío", async () => {
        sendMail.mockResolvedValue(undefined)
        await expect(notifyQuoteReview(review, { salespersonName: "Ana", lineCount: 2 }, t)).resolves.toBe("sent")
        const [mail] = sendMail.mock.calls[0]
        expect(mail.to).toEqual(["review@example.invalid"])
        expect(mail.textBody).toContain("https://admin.example.invalid/admin/quote-reviews/72db466a-e594-48b7-9864-128b4b305b08")
        expect(mail.textBody).toContain("\"salespersonName\":\"Ana\"")
        expect(JSON.stringify(mail)).not.toMatch(/cost|price|profit/i)
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ notificationStatus: "sent", notifiedAt: expect.any(Date), notificationAttempts: { sql: "\"notificationAttempts\" + 1" } }), { where: { id: 3 }, validate: false })
    })

    it("si el correo falla, no lanza: la revisión sigue pendiente y el intento queda como fallido", async () => {
        sendMail.mockRejectedValue(new Error("Graph 503"))
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {})
        await expect(notifyQuoteReview(review, { salespersonName: "Ana", lineCount: 1 }, t)).resolves.toBe("failed")
        expect(consoleError.mock.calls.flat().join(" ")).not.toContain("Graph 503")
        consoleError.mockRestore()
        expect(update.mock.calls[0][0]).toMatchObject({ notificationStatus: "failed" })
        expect(update.mock.calls[0][0]).not.toHaveProperty("notifiedAt")
    })

    it("sin destinatarios configurados no intenta enviar y lo deja registrado", async () => {
        mockEnv.quoteReviewRecipients = []
        await expect(notifyQuoteReview(review, { salespersonName: "Ana", lineCount: 1 }, t)).resolves.toBe("not_configured")
        expect(sendMail).not.toHaveBeenCalled()
        expect(update.mock.calls[0][0]).toMatchObject({ notificationStatus: "not_configured" })
    })
})

describe("notifyRepresentativeOfDecision", () => {
    const findSalesperson = Salesperson.findByPk as jest.Mock
    const decided = (overrides: object) => ({ id: 3, orderId: review.orderId, clientName: "Walmart", salespersonId: 4, clientEmail: "compras@walmart.example", pricing: { finalPrice: 140 }, ...overrides }) as unknown as QuoteOrderReview

    beforeEach(() => findSalesperson.mockReset().mockResolvedValue({ id: 4, name: "Ana", email: "ana@legumex.example" }))

    it("rechazo: solo al representante (correo de su registro), con el motivo y sin montos ni el correo del cliente", async () => {
        sendMail.mockResolvedValue(undefined)
        await expect(notifyRepresentativeOfDecision(decided({ status: "rejected", rejectionReason: "No contamos con el producto" }), t)).resolves.toBe(true)
        const [mail] = sendMail.mock.calls[0]
        expect(mail.to).toBe("ana@legumex.example")
        expect(mail).not.toHaveProperty("cc")
        expect(mail.subject).toContain("quoteReview.decision.rejected.subject")
        expect(mail.textBody).toContain("No contamos con el producto")
        expect(JSON.stringify(mail)).not.toMatch(/140|cost|price|profit|walmart\.example/i)
        // Es un aviso: no registra nada en la revisión (la decisión ya quedó guardada).
        expect(update).not.toHaveBeenCalled()
    })

    it("aprobada sin enviar: aviso sin PDF ni precios", async () => {
        sendMail.mockResolvedValue(undefined)
        await expect(notifyRepresentativeOfDecision(decided({ status: "approved", rejectionReason: null }), t)).resolves.toBe(true)
        const [mail] = sendMail.mock.calls[0]
        expect(mail.subject).toContain("quoteReview.decision.approved.subject")
        expect(mail).not.toHaveProperty("attachment")
        expect(JSON.stringify(mail)).not.toMatch(/140|cost|price|profit/i)
    })

    it("si el correo falla devuelve false sin lanzar ni exponer el error; sin representante no envía", async () => {
        sendMail.mockRejectedValue(new Error("Graph 503"))
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {})
        await expect(notifyRepresentativeOfDecision(decided({ status: "rejected", rejectionReason: "Rentabilidad insuficiente" }), t)).resolves.toBe(false)
        expect(consoleError.mock.calls.flat().join(" ")).not.toContain("Graph 503")
        consoleError.mockRestore()
        sendMail.mockReset()
        await expect(notifyRepresentativeOfDecision(decided({ status: "approved", salespersonId: null }), t)).resolves.toBe(false)
        expect(sendMail).not.toHaveBeenCalled()
    })
})
