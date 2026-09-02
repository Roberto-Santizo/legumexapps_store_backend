import "reflect-metadata"

// Mocks manuales del SDK de Microsoft Graph y de @azure/identity: email.service.ts no hace
// ninguna llamada de red real en pruebas -- se captura el `authProvider` que el service le pasa a
// Client.initWithMiddleware (se arma una sola vez al importar el módulo, ver email.service.ts)
// para poder probarlo de forma aislada, y se mockea `.api(...).post(...)` para inspeccionar
// exactamente el payload que se manda a Graph.
const mockGetToken = jest.fn()
jest.mock("@azure/identity", () => ({
    ClientSecretCredential: jest.fn().mockImplementation(() => ({ getToken: mockGetToken }))
}))

const mockPost = jest.fn()
const mockApi = jest.fn(() => ({ post: mockPost }))
let capturedAuthProvider: { getAccessToken: () => Promise<string> } | undefined
jest.mock("@microsoft/microsoft-graph-client", () => ({
    Client: {
        initWithMiddleware: jest.fn((config: { authProvider: { getAccessToken: () => Promise<string> } }) => {
            capturedAuthProvider = config.authProvider
            return { api: mockApi }
        })
    }
}))

jest.mock("../../config/env", () => ({
    env: {
        microsoftTenantId: "test-tenant-id",
        microsoftClientId: "test-client-id",
        microsoftClientSecret: "test-client-secret",
        noreplyUser: "noreply@legumex.net"
    }
}))

import { emailService } from "./email.service"

describe("emailService.sendMailWithAttachment", () => {
    beforeEach(() => {
        mockPost.mockReset()
        mockApi.mockClear()
    })

    it("llama al endpoint de Graph del buzón noreply configurado en env.noreplyUser", async () => {
        mockPost.mockResolvedValue(undefined)

        await emailService.sendMailWithAttachment({
            to: "cliente@empresa.com",
            subject: "Cotización",
            textBody: "Hola, adjunto la cotización.",
            attachment: { buffer: Buffer.from("PDF-CONTENT"), fileName: "cotizacion.pdf", contentType: "application/pdf" }
        })

        expect(mockApi).toHaveBeenCalledWith("/users/noreply@legumex.net/sendMail")
    })

    it("arma el payload de Graph con el adjunto codificado en base64 (no el buffer crudo)", async () => {
        mockPost.mockResolvedValue(undefined)
        const buffer = Buffer.from("hello world")

        await emailService.sendMailWithAttachment({
            to: "cliente@empresa.com",
            subject: "Cotización para Cliente Uno",
            textBody: "Hola, adjunto la cotización.",
            attachment: { buffer, fileName: "cotizacion.pdf", contentType: "application/pdf" }
        })

        expect(mockPost).toHaveBeenCalledWith({
            message: {
                subject: "Cotización para Cliente Uno",
                body: { contentType: "Text", content: "Hola, adjunto la cotización." },
                toRecipients: [{ emailAddress: { address: "cliente@empresa.com" } }],
                attachments: [{
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    name: "cotizacion.pdf",
                    contentType: "application/pdf",
                    contentBytes: buffer.toString("base64")
                }]
            }
        })
    })

    it("propaga el error si Graph rechaza el envío (ej. permiso no concedido, destinatario inválido)", async () => {
        mockPost.mockRejectedValue(new Error("Graph API error: Forbidden"))

        await expect(
            emailService.sendMailWithAttachment({
                to: "cliente@empresa.com",
                subject: "Cotización",
                textBody: "Hola",
                attachment: { buffer: Buffer.from("x"), fileName: "a.pdf", contentType: "application/pdf" }
            })
        ).rejects.toThrow("Graph API error: Forbidden")
    })

    describe("authProvider.getAccessToken (client credentials contra Azure AD)", () => {
        it("devuelve el token cuando Azure AD sí lo entrega", async () => {
            mockGetToken.mockResolvedValue({ token: "abc123" })

            await expect(capturedAuthProvider!.getAccessToken()).resolves.toBe("abc123")
        })

        it("rechaza explícito si Azure AD devuelve null (credenciales/permiso mal configurados) en vez de mandar un token undefined a Graph", async () => {
            mockGetToken.mockResolvedValue(null)

            await expect(capturedAuthProvider!.getAccessToken()).rejects.toThrow(
                "No se pudo obtener un access token de Microsoft Graph"
            )
        })
    })
})
