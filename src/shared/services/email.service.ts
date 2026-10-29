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

interface SendMailInput {
    to: string | string[]
    subject: string
    textBody: string
}

interface SendMailWithAttachmentInput extends SendMailInput {
    to: string
    cc?: string[]
    attachment: EmailAttachment
}

function postMessage(input: SendMailInput & { cc?: string[] }, attachments?: object[]): Promise<void> {
    return graphClient.api(`/users/${env.noreplyUser}/sendMail`).post({
        message: {
            subject: input.subject,
            body: { contentType: "Text", content: input.textBody },
            toRecipients: [input.to].flat().map(address => ({ emailAddress: { address } })),
            ...(input.cc?.length ? { ccRecipients: input.cc.map(address => ({ emailAddress: { address } })) } : {}),
            ...(attachments ? { attachments } : {}),
        },
    })
}

async function sendMailWithAttachment(input: SendMailWithAttachmentInput): Promise<void> {
    await postMessage(input, [
        {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: input.attachment.fileName,
            contentType: input.attachment.contentType,
            contentBytes: input.attachment.buffer.toString("base64"),
        },
    ])
}

// Sin adjunto, a uno o varios destinatarios (p. ej. el aviso de revisión gerencial).
async function sendMail(input: SendMailInput): Promise<void> {
    await postMessage(input)
}

export const emailService = {
    sendMail,
    sendMailWithAttachment,
}
