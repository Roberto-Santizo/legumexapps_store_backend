import "reflect-metadata"

const mockEnv = { frontendUrl: "https://admin.example.invalid", quoteReviewRecipients: ["review@example.invalid"] as string[] }
jest.mock("../../../config/env", () => ({ env: mockEnv }))
jest.mock("../../../shared/services/email.service", () => ({ emailService: { sendMail: jest.fn() } }))
jest.mock("../models/QuoteOrderReview.model", () => ({
    __esModule: true,
    default: { update: jest.fn(), sequelize: { literal: (sql: string) => ({ sql }) } },
}))

import QuoteOrderReview from "../models/QuoteOrderReview.model"
import { emailService } from "../../../shared/services/email.service"
import { notifyQuoteReview } from "./quoteReviewNotification"

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
