import type { Transaction } from "sequelize"
import QuoteOrderReview from "../models/QuoteOrderReview.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import Client from "../../client/models/Client.model"
import User from "../../accessControl/user/models/User.model"
import { buildOrderProfit, parseProfitPerPound } from "../../pricing/services/quoteProfit"
import { loadQuoteOrderLines, quoteOrderLinesDigest } from "./quoteOrderLines"
import type { QuoteOrderAuthor, QuoteOrderLine } from "./quoteOrderLines"
import { notifyQuoteReview, notifyRepresentativeOfDecision } from "./quoteReviewNotification"
import type { Translate } from "./quoteReviewNotification"
import { isDeliveryAvailable, sendQuoteDelivery } from "./quoteReviewDelivery"
import { lockQuoteOrder } from "./quoteOrderLock"
import type { QuoteReviewPdf } from "./quoteReviewDelivery"
import type { ListQuoteReviewsQuery, QuoteReviewApproveInput, QuoteReviewDeliveryInput } from "../schemas/quoteReview.schema"
import { AppError } from "../../../shared/errors/AppError"
import { roundMoney, toDecimal } from "../../../shared/utils/money.util"

const notFound = () => new AppError(404, "errors.quote_review_order_not_found")

// Todo cambio de una revisión se serializa por pedido (dos clics, reintentos de red o el
// representante reenviando mientras gerencia decide): un solo resultado, nunca dos decisiones.
function lockedOrder<T>(orderId: string, work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return QuoteOrderReview.sequelize!.transaction(async transaction => {
        await lockQuoteOrder(orderId, transaction)
        return work(transaction)
    })
}

function authorOf(review: QuoteOrderReview): QuoteOrderAuthor {
    return review.salespersonId != null ? { salespersonId: review.salespersonId } : { staff: true }
}

// Solo un pedido pendiente admite una decisión de gerencia; aprobado y rechazado son finales.
function assertPending(review: QuoteOrderReview): void {
    if (review.status === "approved") throw new AppError(409, "errors.quote_review_already_approved")
    if (review.status === "rejected") throw new AppError(409, "errors.quote_review_rejected")
}

// Si el cliente registrado del pedido no tenía correo, el nuevo queda en su ficha; si ya tenía uno, la
// ficha no cambia (un pedido puede ir a otro correo). Nunca toca a otro cliente.
async function rememberClientEmail(clientId: number | null, clientEmail: string, transaction: Transaction): Promise<void> {
    if (clientId != null) await Client.update({ email: clientEmail }, { where: { id: clientId, email: null }, transaction })
}

// Ganancia del pedido con la referencia de cada línea: lo que se guarda al aprobar.
function pricingOf(lines: QuoteOrderLine[], profitPerPound: number | string) {
    const order = buildOrderProfit(lines, profitPerPound)
    return {
        ...order,
        lines: order.lines.map((line, index) => ({
            kind: lines[index].kind,
            quoteId: lines[index].quoteId,
            productDisplayName: lines[index].productDisplayName,
            totalCost: roundMoney(toDecimal(lines[index].totalCost)),
            ...line,
        })),
    }
}

type QuoteOrderPricing = ReturnType<typeof pricingOf>

// Lo que ve el REPRESENTANTE: el estado, el correo del cliente del pedido, a quién se autorizó el envío
// y, si se rechazó, el motivo. Nunca el costo ni la ganancia. El precio final solo aparece cuando
// gerencia autorizó el envío comercial (a él, o a él con copia al cliente): aprobar sin enviar no lo
// libera, así nadie arma la cotización comercial por fuera de esa decisión.
function representativeView(review: QuoteOrderReview) {
    const pricing = review.pricing as QuoteOrderPricing | null
    const pricesReleased = review.status === "approved" && review.deliveryRecipients != null && pricing
    return {
        orderId: review.orderId,
        status: review.status,
        submittedAt: review.get("createdAt") as Date,
        reviewedAt: review.reviewedAt,
        clientEmail: review.clientEmail,
        deliveryStatus: review.deliveryStatus,
        deliveryRecipients: review.deliveryRecipients,
        ...(review.status === "rejected" ? { rejectionReason: review.rejectionReason } : {}),
        ...(pricesReleased ? {
            finalPrice: pricing.finalPrice,
            lines: pricing.lines.map(line => ({ kind: line.kind, quoteId: line.quoteId, finalPrice: line.finalPrice })),
        } : {}),
    }
}

// Quién envió y quién decidió: solo id y nombre.
const reviewPeople = [
    { model: Salesperson, as: "submittingSalesperson", attributes: ["id", "name"] },
    { model: User, as: "reviewingUser", attributes: ["id", "name"] },
]

// Lo que ve gerencia: la revisión, cada línea con su costo congelado, la huella actual que debe
// mandar de vuelta al aprobar, si puede enviar ya la cotización comercial y el correo del cliente que
// se propone para la copia (el del pedido o, si no tiene, el de la ficha del cliente).
async function getReviewDetail(orderId: string) {
    const review = await QuoteOrderReview.findOne({
        where: { orderId },
        include: [...reviewPeople, { model: Client, as: "orderClient", attributes: ["id", "email"] }],
    })
    if (!review) throw notFound()
    const lines = await loadQuoteOrderLines(orderId, authorOf(review))
    const { orderClient, ...reviewData } = review.toJSON() as Record<string, unknown> & { orderClient?: { email: string | null } | null }
    return {
        review: reviewData,
        lines: lines.map(line => ({ kind: line.kind, ...line.record })),
        linesDigest: quoteOrderLinesDigest(lines),
        deliveryAvailable: isDeliveryAvailable(review),
        suggestedClientEmail: review.clientEmail ?? orderClient?.email ?? null,
    }
}

async function findReview(orderId: string, transaction?: Transaction) {
    const review = await QuoteOrderReview.findOne({ where: { orderId }, transaction })
    if (!review) throw notFound()
    return review
}

async function notify(review: QuoteOrderReview, lineCount: number, t: Translate) {
    const salesperson = review.salespersonId != null ? await Salesperson.findByPk(review.salespersonId, { attributes: ["id", "name"] }) : null
    return notifyQuoteReview(review, { salespersonName: salesperson?.name ?? "", lineCount }, t)
}

// El representante envía SU pedido a revisión; el correo del cliente es opcional. Reenviar el mismo
// pedido sin cambios no duplica nada; si agregó líneas mientras estaba pendiente, la revisión se
// actualiza y se avisa de nuevo (cambiar solo el correo no reavisa). Sin correo, el que ya tenía el
// pedido se conserva (dejar el campo vacío nunca lo borra). Un pedido aprobado o rechazado no se puede
// cambiar: hay que empezar otro.
async function submitForReview(salespersonId: number, orderId: string, clientEmail: string | undefined, t: Translate) {
    const { review, lineCount, shouldNotify } = await lockedOrder(orderId, async transaction => {
        const lines = await loadQuoteOrderLines(orderId, { salespersonId }, transaction)
        if (!lines.length) throw notFound()
        // Cada línea necesita su peso neto antes de que gerencia pueda fijarle una ganancia por libra.
        buildOrderProfit(lines, 0)
        const linesDigest = quoteOrderLinesDigest(lines)
        const existing = await QuoteOrderReview.findOne({ where: { orderId }, transaction })
        if (existing && existing.salespersonId !== salespersonId) throw notFound()
        if (existing?.status === "rejected") throw new AppError(409, "errors.quote_review_rejected")
        if (existing?.status === "approved") {
            if (existing.linesDigest !== linesDigest) throw new AppError(409, "errors.quote_review_already_approved")
            return { review: existing, lineCount: lines.length, shouldNotify: false }
        }
        const order = lines[0].record.breakdown?.order
        if (clientEmail) await rememberClientEmail(order?.clientId ?? null, clientEmail, transaction)
        if (existing) {
            const emailChange = clientEmail && existing.clientEmail !== clientEmail ? { clientEmail } : null
            if (existing.linesDigest === linesDigest) {
                if (emailChange) await existing.update(emailChange, { transaction })
                return { review: existing, lineCount: lines.length, shouldNotify: false }
            }
            await existing.update({ linesDigest, notificationStatus: "pending", ...emailChange }, { transaction })
            return { review: existing, lineCount: lines.length, shouldNotify: true }
        }
        const created = await QuoteOrderReview.create({ orderId, salespersonId, clientId: order?.clientId ?? null, clientName: order?.clientName ?? "", clientEmail: clientEmail ?? null, linesDigest }, { transaction })
        return { review: created, lineCount: lines.length, shouldNotify: true }
    })
    if (shouldNotify) await notify(review, lineCount, t)
    return representativeView(await review.reload())
}

async function getRepresentativeReview(salespersonId: number, orderId: string) {
    const review = await QuoteOrderReview.findOne({ where: { orderId, salespersonId } })
    if (!review) throw notFound()
    return representativeView(review)
}

async function listReviews(filters: ListQuoteReviewsQuery = {}) {
    return QuoteOrderReview.findAll({
        ...(filters.status ? { where: { status: filters.status } } : {}),
        include: reviewPeople,
        order: [["createdAt", "DESC"]],
    })
}

// Gerencia prueba un monto por libra: calcula sobre las líneas actuales y no guarda nada. Devuelve
// también la huella de esas líneas: la aprobación debe llevar la del cálculo que gerencia vio.
async function previewReview(orderId: string, profitPerPound: number | string) {
    const review = await findReview(orderId)
    if (review.status === "rejected") throw new AppError(409, "errors.quote_review_rejected")
    const lines = await loadQuoteOrderLines(orderId, authorOf(review))
    return { ...pricingOf(lines, profitPerPound), linesDigest: quoteOrderLinesDigest(lines) }
}

// Reserva el envío comercial que gerencia autoriza, dentro del bloqueo del pedido: valida que la
// cotización esté aprobada (nunca una rechazada o pendiente), que no se haya enviado ya y, con copia al
// cliente, que haya un correo válido (el que escribe gerencia o el que ya tiene el pedido). Un correo
// nuevo queda en el pedido y, si la ficha del cliente no tenía, también en ella. Si algo no cumple,
// lanza y la transacción no guarda nada. La reserva renueva siempre updatedAt, aunque repita los mismos
// datos (Sequelize omitiría el UPDATE): es la marca de este intento, con la que vence y se cierra.
async function claimDelivery(review: QuoteOrderReview, delivery: QuoteReviewDeliveryInput, transaction: Transaction): Promise<void> {
    if (review.status === "rejected") throw new AppError(409, "errors.quote_review_rejected")
    if (review.status !== "approved") throw new AppError(409, "errors.quote_review_not_approved")
    if (review.salespersonId == null) throw new AppError(409, "errors.quote_review_delivery_not_required")
    if (!isDeliveryAvailable(review)) throw new AppError(409, "errors.quote_review_delivery_already_sent")
    const includesClient = delivery.recipients === "representative_and_client"
    const clientEmail = includesClient ? delivery.clientEmail ?? review.clientEmail : null
    if (includesClient && !clientEmail) throw new AppError(422, "errors.quote_review_client_email_required")
    if (includesClient && delivery.clientEmail) await rememberClientEmail(review.clientId, delivery.clientEmail, transaction)
    review.set({ deliveryRecipients: delivery.recipients, deliveryStatus: "sending", ...(clientEmail ? { clientEmail } : {}) })
    review.changed("updatedAt", true)
    await review.save({ transaction })
}

// Gerencia aprueba con el monto por libra, la huella de las líneas que vio y su decisión explícita de
// envío. Si el pedido cambió, se rechaza (409) para que revise lo actual. Repetir la misma aprobación
// (reintento de red) devuelve el mismo resultado sin volver a avisar; otra distinta se rechaza.
// - delivery "none": solo aprueba y avisa al representante (sin PDF ni montos). No acepta PDF.
// - "representative" / "representative_and_client": exige el PDF final y lo envía después de
//   confirmar la aprobación. Si el envío no se puede autorizar (p. ej. falta el correo del cliente),
//   no se aprueba nada. Si el correo falla, la aprobación se conserva y gerencia lo reintenta.
async function approveReview(orderId: string, input: QuoteReviewApproveInput, reviewedByUserId: number, pdf: QuoteReviewPdf | undefined, t: Translate) {
    const delivery = input.delivery === "none" ? null : { recipients: input.delivery, clientEmail: input.clientEmail }
    if (delivery && !pdf) throw new AppError(422, "errors.quote_pdf_missing_file")
    if (!delivery && pdf) throw new AppError(422, "errors.quote_review_unexpected_pdf")
    const { review, approvedNow, sendsQuote } = await lockedOrder(orderId, async transaction => {
        const review = await findReview(orderId, transaction)
        if (review.status === "rejected") throw new AppError(409, "errors.quote_review_rejected")
        const lines = await loadQuoteOrderLines(orderId, authorOf(review), transaction)
        const profitPerPound = parseProfitPerPound(input.profitPerPound)
        if (review.status === "approved") {
            const sameApproval = review.linesDigest === input.linesDigest && review.profitPerPound != null && profitPerPound.eq(review.profitPerPound)
            if (!sameApproval) throw new AppError(409, "errors.quote_review_already_approved")
            // Reintento: solo vuelve a enviar si el envío anterior no salió.
            const retriesDelivery = !!delivery && isDeliveryAvailable(review)
            if (retriesDelivery) await claimDelivery(review, delivery, transaction)
            return { review, approvedNow: false, sendsQuote: retriesDelivery }
        }
        const linesDigest = quoteOrderLinesDigest(lines)
        if (input.linesDigest !== linesDigest) throw new AppError(409, "errors.quote_review_changed")
        const pricing = pricingOf(lines, profitPerPound.toString())
        await review.update({ status: "approved", linesDigest, profitPerPound: pricing.profitPerPound, pricing, reviewedByUserId, reviewedAt: new Date() }, { transaction })
        if (delivery) await claimDelivery(review, delivery, transaction)
        return { review, approvedNow: true, sendsQuote: !!delivery }
    })
    if (sendsQuote) await sendQuoteDelivery(review, pdf!, t)
    const representativeNotified = approvedNow && !delivery ? await notifyRepresentativeOfDecision(review, t) : undefined
    return { ...(await getReviewDetail(orderId)), ...(representativeNotified === undefined ? {} : { representativeNotified }) }
}

// Envío comercial posterior (aprobada sin enviar) o reintento de uno fallido. El PDF lo vuelve a generar
// gerencia con el precio final guardado al aprobar.
async function deliverReview(orderId: string, delivery: QuoteReviewDeliveryInput, pdf: QuoteReviewPdf, t: Translate) {
    const review = await lockedOrder(orderId, async transaction => {
        const review = await findReview(orderId, transaction)
        await claimDelivery(review, delivery, transaction)
        return review
    })
    return { deliveryStatus: await sendQuoteDelivery(review, pdf, t) }
}

// Gerencia rechaza un pedido pendiente con un motivo obligatorio: no se calcula ganancia ni se genera
// cotización comercial, y nada va al cliente. Se avisa al representante con el motivo. Repetir el mismo
// rechazo (reintento de red) no vuelve a avisar; un pedido aprobado no se puede rechazar.
async function rejectReview(orderId: string, reason: string, reviewedByUserId: number, t: Translate) {
    const { review, rejectedNow } = await lockedOrder(orderId, async transaction => {
        const review = await findReview(orderId, transaction)
        if (review.status === "rejected" && review.rejectionReason === reason) return { review, rejectedNow: false }
        assertPending(review)
        await review.update({ status: "rejected", rejectionReason: reason, reviewedByUserId, reviewedAt: new Date() }, { transaction })
        return { review, rejectedNow: true }
    })
    const representativeNotified = rejectedNow ? await notifyRepresentativeOfDecision(review, t) : undefined
    return { ...(await getReviewDetail(orderId)), ...(representativeNotified === undefined ? {} : { representativeNotified }) }
}

// Reenvía el aviso de un pedido pendiente (falló, faltaba configurar el destinatario o se perdió).
async function resendNotification(orderId: string, t: Translate) {
    const review = await findReview(orderId)
    assertPending(review)
    const lines = await loadQuoteOrderLines(orderId, authorOf(review))
    return { notificationStatus: await notify(review, lines.length, t) }
}

// Calculadora del admin: el admin fija su propia ganancia por libra para su pedido, sin revisión (el
// pedido queda aprobado). Se vuelve a llamar cada vez que agrega una línea o cambia el monto.
async function setAdminOrderPricing(orderId: string, profitPerPound: number | string, userId: number) {
    return lockedOrder(orderId, async transaction => {
        const lines = await loadQuoteOrderLines(orderId, { createdByUserId: userId }, transaction)
        if (!lines.length) throw notFound()
        const existing = await QuoteOrderReview.findOne({ where: { orderId }, transaction })
        if (existing && existing.salespersonId != null) throw new AppError(409, "errors.quote_review_foreign_order")
        const pricing = pricingOf(lines, profitPerPound)
        const values = { status: "approved" as const, linesDigest: quoteOrderLinesDigest(lines), profitPerPound: pricing.profitPerPound, pricing, reviewedByUserId: userId, reviewedAt: new Date(), notificationStatus: "not_required" as const, deliveryStatus: "not_required" as const }
        if (existing) await existing.update(values, { transaction })
        else {
            const order = lines[0].record.breakdown?.order
            await QuoteOrderReview.create({ orderId, salespersonId: null, clientId: order?.clientId ?? null, clientName: order?.clientName ?? "", ...values }, { transaction })
        }
        return pricing
    })
}

export const quoteReviewService = {
    submitForReview,
    getRepresentativeReview,
    listReviews,
    getReviewDetail,
    previewReview,
    approveReview,
    deliverReview,
    rejectReview,
    resendNotification,
    setAdminOrderPricing,
}
