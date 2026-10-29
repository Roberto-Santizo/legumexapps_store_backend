import { z } from "zod"

const recipientSchema = z.email()

// QUOTE_REVIEW_EMAIL: a quién avisar que un pedido espera la revisión gerencial (uno o varios correos
// separados por coma). La dirección vive solo en el entorno, nunca en el código. Ausente = sin aviso
// (la revisión sigue disponible en el admin); un valor mal escrito impide arrancar en lugar de avisar
// en silencio a nadie.
export function parseQuoteReviewRecipients(value: string | undefined): string[] {
    if (value === undefined || value.trim() === "") return []
    const recipients = value.split(",").map(recipient => recipient.trim())
    if (recipients.some(recipient => !recipientSchema.safeParse(recipient).success) || new Set(recipients.map(recipient => recipient.toLowerCase())).size !== recipients.length) {
        throw new Error("Invalid QUOTE_REVIEW_EMAIL: configure one or more distinct email addresses separated by commas")
    }
    return recipients
}
