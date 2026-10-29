import { Op } from "sequelize"
import QuoteOrderReview from "../models/QuoteOrderReview.model"
import type { QuoteReviewClientEmailStatus } from "../models/QuoteOrderReview.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import { emailService } from "../../../shared/services/email.service"
import type { Translate } from "./quoteReviewNotification"

export type QuoteReviewPdf = { buffer: Buffer; fileName: string }

// Un envío que quedó en "sending" más de este tiempo se considera interrumpido (proceso caído) y se
// puede volver a intentar.
const SENDING_TIMEOUT_MS = 10 * 60 * 1000

// Si gerencia puede (re)enviar ya la cotización aprobada: nunca empezó, falló o quedó interrumpida.
// Misma regla que claimClientEmail, para que la pantalla ofrezca el reenvío exactamente cuando procede.
export function isClientEmailRetryable(review: QuoteOrderReview, now = Date.now()): boolean {
    if (review.status !== "approved" || !review.clientEmail) return false
    if (review.clientEmailStatus === "pending" || review.clientEmailStatus === "failed") return true
    const updatedAt = review.get("updatedAt") as Date | undefined
    return review.clientEmailStatus === "sending" && !!updatedAt && updatedAt.getTime() < now - SENDING_TIMEOUT_MS
}

// Toma el envío de forma atómica: de dos aprobaciones o reenvíos simultáneos solo uno lo consigue, así
// el cliente nunca recibe el correo dos veces por una carrera.
async function claimClientEmail(reviewId: number): Promise<boolean> {
    const [claimed] = await QuoteOrderReview.update({ clientEmailStatus: "sending" }, {
        where: {
            id: reviewId,
            status: "approved",
            clientEmail: { [Op.ne]: null },
            [Op.or]: [
                { clientEmailStatus: { [Op.in]: ["pending", "failed"] } },
                { clientEmailStatus: "sending", updatedAt: { [Op.lt]: new Date(Date.now() - SENDING_TIMEOUT_MS) } },
            ],
        },
        validate: false,
    })
    return claimed === 1
}

// PDF con el precio final al cliente del pedido, con copia al representante que lo envió. El PDF lo
// genera el navegador de gerencia al aprobar (mismo documento que el del representante, sin costos).
// Se llama después de confirmar la aprobación: si el correo falla, la aprobación se conserva y el
// intento queda registrado para reenviarlo desde el detalle. null = otro proceso ya lo envió o lo está
// enviando. Si el proveedor falla después de entregar el correo, queda como "failed": un reenvío manual
// podría duplicarlo (Graph no confirma la entrega de forma idempotente).
export async function sendApprovedQuoteToClient(review: QuoteOrderReview, pdf: QuoteReviewPdf, t: Translate): Promise<QuoteReviewClientEmailStatus | null> {
    if (!review.clientEmail || !(await claimClientEmail(review.id))) return null
    const salesperson = review.salespersonId != null ? await Salesperson.findByPk(review.salespersonId, { attributes: ["id", "name", "email"] }) : null
    const cc = salesperson?.email && salesperson.email.toLowerCase() !== review.clientEmail ? [salesperson.email] : []
    let status: QuoteReviewClientEmailStatus
    try {
        await emailService.sendMailWithAttachment({
            to: review.clientEmail,
            cc,
            subject: t("quoteReview.clientEmail.subject", { clientName: review.clientName }),
            textBody: t("quoteReview.clientEmail.body", { clientName: review.clientName, salespersonName: salesperson?.name ?? "Legumex" }),
            attachment: { buffer: pdf.buffer, fileName: pdf.fileName, contentType: "application/pdf" },
        })
        status = "sent"
    } catch {
        console.error("[quoteReview] no se pudo enviar la cotización aprobada al cliente; detalles sensibles omitidos")
        status = "failed"
    }
    await QuoteOrderReview.update(
        { clientEmailStatus: status, ...(status === "sent" ? { clientEmailedAt: new Date() } : {}) },
        { where: { id: review.id, clientEmailStatus: "sending" }, validate: false }
    )
    return status
}
