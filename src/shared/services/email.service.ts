import { Client } from "@microsoft/microsoft-graph-client"
import { ClientSecretCredential } from "@azure/identity"
import { env } from "../../config/env"

// Cliente de Microsoft Graph autenticado con client credentials (app-only, sin usuario/contraseña
// de por medio) -- misma app de Azure AD que ya tiene permiso de aplicación Mail.Send sobre el
// buzón env.noreplyUser. Se construye una sola vez al cargar el módulo (mismo patrón que
// s3.service.ts con S3Client) -- el SDK de Graph cachea el access token internamente y lo renueva
// solo cuando expira, no hay que gestionar el ciclo de vida del token a mano acá.
const credential = new ClientSecretCredential(env.microsoftTenantId, env.microsoftClientId, env.microsoftClientSecret)

const graphClient = Client.initWithMiddleware({
    authProvider: {
        getAccessToken: async () => {
            const token = await credential.getToken("https://graph.microsoft.com/.default")
            // getToken puede devolver null si la app de Azure AD no está bien configurada (permiso
            // no concedido/no admin-consented, credenciales rotadas, etc.) -- se rechaza explícito
            // en vez de mandar accessToken: undefined al SDK de Graph, que daría un 401 más
            // confuso más adelante.
            if (!token) throw new Error("No se pudo obtener un access token de Microsoft Graph")
            return token.token
        }
    }
})

interface EmailAttachment {
    buffer: Buffer
    fileName: string
    contentType: string
}

interface SendMailWithAttachmentInput {
    to: string
    subject: string
    textBody: string
    attachment: EmailAttachment
}

// Único punto de envío de correo de todo el repo -- hoy solo lo usa quoteService (adjuntar el PDF
// de una cotización), pero es genérico a propósito (no sabe nada de Quote) para poder reusarse si
// aparece otro caso de envío de correo con adjunto más adelante.
async function sendMailWithAttachment(input: SendMailWithAttachmentInput): Promise<void> {
    await graphClient.api(`/users/${env.noreplyUser}/sendMail`).post({
        message: {
            subject: input.subject,
            // contentType "Text" (no "HTML"): el texto viene tal cual lo compuso el front (con
            // saltos de línea simples) -- convertirlo a HTML implicaría escapar/transformar ese
            // texto acá, otro lugar más donde el mensaje podría desalinearse del que ve el
            // usuario antes de confirmar el envío.
            body: { contentType: "Text", content: input.textBody },
            toRecipients: [{ emailAddress: { address: input.to } }],
            attachments: [
                {
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    name: input.attachment.fileName,
                    contentType: input.attachment.contentType,
                    contentBytes: input.attachment.buffer.toString("base64"),
                },
            ],
        },
    })
}

export const emailService = {
    sendMailWithAttachment,
}
