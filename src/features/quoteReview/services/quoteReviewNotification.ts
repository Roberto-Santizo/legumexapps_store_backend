import QuoteOrderReview from "../models/QuoteOrderReview.model"
import type { QuoteReviewNotificationStatus } from "../models/QuoteOrderReview.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import { emailService } from "../../../shared/services/email.service"
import { env } from "../../../config/env"

export type Translate = (key: string, options?: Record<string, unknown>) => string

// Aviso a gerencia de que un pedido espera revisión: quién, para qué cliente, cuántas líneas y el
// enlace al admin. NUNCA costos (un correo se reenvía y queda en buzones) y nunca otorga permisos: el
// enlace exige iniciar sesión con quotes:review. Se envía después de confirmar la revisión en la base;
// si falla, la revisión sigue pendiente y el intento queda registrado para reenviarlo desde el admin.
export async function notifyQuoteReview(review: QuoteOrderReview, context: { salespersonName: string; lineCount: number }, t: Translate): Promise<QuoteReviewNotificationStatus> {
    const recipients = env.quoteReviewRecipients
    let status: QuoteReviewNotificationStatus = "not_configured"
    if (recipients.length) {
        try {
            await emailService.sendMail({
                to: [...recipients],
                subject: t("quoteReview.email.subject", { clientName: review.clientName }),
                textBody: t("quoteReview.email.body", {
                    clientName: review.clientName,
                    salespersonName: context.salespersonName,
                    count: context.lineCount,
                    link: `${env.frontendUrl}/admin/quote-reviews/${review.orderId}`,
                }),
            })
            status = "sent"
        } catch {
            console.error("[quoteReview] no se pudo enviar el aviso de revisión; detalles sensibles omitidos")
            status = "failed"
        }
    }
    await QuoteOrderReview.update(
        { notificationStatus: status, notificationAttempts: QuoteOrderReview.sequelize!.literal(`"notificationAttempts" + 1`), ...(status === "sent" ? { notifiedAt: new Date() } : {}) },
        { where: { id: review.id }, validate: false }
    )
    return status
}

// Aviso interno al representante cuando gerencia decide SIN envío comercial: aprobó sin enviar, o rechazó
// (con el motivo). Nunca lleva PDF, precios, costos ni ganancia, y nunca va al cliente; el correo del
// representante sale de su registro. Se envía después de confirmar la decisión: si falla, la decisión se
// conserva y se devuelve false para que gerencia lo sepa. No se reintenta solo: repetir la decisión no
// vuelve a avisar, así nunca hay avisos ni decisiones duplicadas.
export async function notifyRepresentativeOfDecision(review: QuoteOrderReview, t: Translate): Promise<boolean> {
    const salesperson = review.salespersonId != null ? await Salesperson.findByPk(review.salespersonId, { attributes: ["id", "name", "email"] }) : null
    if (!salesperson?.email) return false
    const template = review.status === "rejected" ? "quoteReview.decision.rejected" : "quoteReview.decision.approved"
    const texts = { clientName: review.clientName, salespersonName: salesperson.name, reason: review.rejectionReason ?? "" }
    try {
        await emailService.sendMail({ to: salesperson.email, subject: t(`${template}.subject`, texts), textBody: t(`${template}.body`, texts) })
        return true
    } catch {
        console.error("[quoteReview] no se pudo avisar al representante de la decisión; detalles sensibles omitidos")
        return false
    }
}
