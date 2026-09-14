import { Client } from "@microsoft/microsoft-graph-client"
import { ClientSecretCredential } from "@azure/identity"
import { env } from "../../config/env"

const credential = new ClientSecretCredential(env.microsoftTenantId, env.microsoftClientId, env.microsoftClientSecret)

const graphClient = Client.initWithMiddleware({
    authProvider: {
        getAccessToken: async () => {
            const token = await credential.getToken("https://graph.microsoft.com/.default")
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


async function sendMailWithAttachment(input: SendMailWithAttachmentInput): Promise<void> {
    await graphClient.api(`/users/${env.noreplyUser}/sendMail`).post({
        message: {
            subject: input.subject,
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
