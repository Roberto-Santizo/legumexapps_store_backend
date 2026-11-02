import QuoteOrderReview from "../models/QuoteOrderReview.model"
import type { QuoteReviewDeliveryStatus } from "../models/QuoteOrderReview.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import { emailService } from "../../../shared/services/email.service"
import type { Translate } from "./quoteReviewNotification"

export type QuoteReviewPdf = { buffer: Buffer; fileName: string }

// Un envío que quedó en "sending" más de este tiempo se considera interrumpido (proceso caído) y se
// puede volver a intentar.
const SENDING_TIMEOUT_MS = 10 * 60 * 1000

// Si gerencia puede enviar ya la cotización comercial: aprobada, de un representante (los pedidos del
// admin envían su PDF desde la calculadora) y sin un envío exitoso ni en curso. Hay un solo envío
// exitoso por pedido; uno fallido o interrumpido se puede reintentar.
export function isDeliveryAvailable(review: QuoteOrderReview, now = Date.now()): boolean {
    if (review.status !== "approved" || review.salespersonId == null) return false
    if (review.deliveryStatus === "pending" || review.deliveryStatus === "failed") return true
    const updatedAt = review.get("updatedAt") as Date | undefined
    return review.deliveryStatus === "sending" && !!updatedAt && updatedAt.getTime() < now - SENDING_TIMEOUT_MS
}

// Envía la cotización comercial ya reservada (deliveryStatus "sending", reservado bajo el bloqueo del
// pedido por quoteReview.service::claimDelivery) al representante que la generó, y con copia al cliente
// solo si gerencia lo autorizó. El correo del representante sale siempre de su registro, nunca del
// navegador. El PDF lo genera el navegador de gerencia con el precio final aprobado (mismo documento del
// representante, sin costos). Se llama después de confirmar la transacción: si el correo falla, la
// aprobación se conserva y el envío queda "failed" para reintentarlo. Si el proveedor falla después de
// entregar el correo, también queda "failed": un reintento podría duplicarlo (Graph no confirma la
// entrega de forma idempotente). El cierre solo toca la reserva de ESTE intento (mismo updatedAt): si
// venció y otro intento la renovó, un proceso tardío no pisa su resultado.
export async function sendQuoteDelivery(review: QuoteOrderReview, pdf: QuoteReviewPdf, t: Translate): Promise<QuoteReviewDeliveryStatus> {
    const salesperson = review.salespersonId != null ? await Salesperson.findByPk(review.salespersonId, { attributes: ["id", "name", "email"] }) : null
    const includesClient = review.deliveryRecipients === "representative_and_client"
    let status: QuoteReviewDeliveryStatus = "failed"
    if (salesperson?.email) {
        const cc = includesClient && review.clientEmail && review.clientEmail !== salesperson.email.toLowerCase() ? [review.clientEmail] : []
        const template = includesClient ? "quoteReview.delivery.withClient" : "quoteReview.delivery.representative"
        const texts = { clientName: review.clientName, salespersonName: salesperson.name }
        try {
            await emailService.sendMailWithAttachment({
                to: salesperson.email,
                cc,
                subject: t(`${template}.subject`, texts),
                textBody: t(`${template}.body`, texts),
                attachment: { buffer: pdf.buffer, fileName: pdf.fileName, contentType: "application/pdf" },
            })
            status = "sent"
        } catch {
            console.error("[quoteReview] no se pudo enviar la cotización aprobada; detalles sensibles omitidos")
        }
    }
    await QuoteOrderReview.update(
        { deliveryStatus: status, ...(status === "sent" ? { deliveredAt: new Date() } : {}) },
        { where: { id: review.id, deliveryStatus: "sending", updatedAt: review.get("updatedAt") as Date }, validate: false }
    )
    return status
}
