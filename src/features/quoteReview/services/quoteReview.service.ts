import type { Transaction } from "sequelize"
import QuoteOrderReview from "../models/QuoteOrderReview.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import Client from "../../client/models/Client.model"
import User from "../../accessControl/user/models/User.model"
import { buildOrderProfit, parseProfitPerPound } from "../../pricing/services/quoteProfit"
import { loadQuoteOrderLines, quoteOrderLinesDigest } from "./quoteOrderLines"
import type { QuoteOrderAuthor, QuoteOrderLine } from "./quoteOrderLines"
import { notifyQuoteReview } from "./quoteReviewNotification"
import type { Translate } from "./quoteReviewNotification"
import { isClientEmailRetryable, sendApprovedQuoteToClient } from "./quoteReviewClientEmail"
import { lockQuoteOrder } from "./quoteOrderLock"
import type { QuoteReviewPdf } from "./quoteReviewClientEmail"
import type { ListQuoteReviewsQuery, QuoteReviewApproveInput } from "../schemas/quoteReview.schema"
import { AppError } from "../../../shared/errors/AppError"
import { roundMoney, toDecimal } from "../../../shared/utils/money.util"

const notFound = () => new AppError(404, "errors.quote_review_order_not_found")

// Todo cambio de una revisión se serializa por pedido (dos clics, reintentos de red o el
// representante reenviando mientras gerencia aprueba): un solo resultado, nunca dos aprobaciones.
function lockedOrder<T>(orderId: string, work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return QuoteOrderReview.sequelize!.transaction(async transaction => {
        await lockQuoteOrder(orderId, transaction)
        return work(transaction)
    })
}

function authorOf(review: QuoteOrderReview): QuoteOrderAuthor {
    return review.salespersonId != null ? { salespersonId: review.salespersonId } : { staff: true }
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

// Lo que ve el REPRESENTANTE: el estado, a qué correo va la cotización y, ya aprobado, solo los
// precios finales. Nunca el costo ni la ganancia.
function representativeView(review: QuoteOrderReview) {
    const pricing = review.pricing as QuoteOrderPricing | null
    return {
        orderId: review.orderId,
        status: review.status,
        submittedAt: review.get("createdAt") as Date,
        reviewedAt: review.reviewedAt,
        clientEmail: review.clientEmail,
        clientEmailStatus: review.clientEmailStatus,
        ...(review.status === "approved" && pricing ? {
            finalPrice: pricing.finalPrice,
            lines: pricing.lines.map(line => ({ kind: line.kind, quoteId: line.quoteId, finalPrice: line.finalPrice })),
        } : {}),
    }
}

// Lo que ve gerencia: la revisión, cada línea con su costo congelado, la huella actual que debe
// mandar de vuelta al aprobar y si puede reenviar la cotización al cliente.
function detailView(review: QuoteOrderReview, lines: QuoteOrderLine[]) {
    return {
        review: review.toJSON(),
        lines: lines.map(line => ({ kind: line.kind, ...line.record })),
        linesDigest: quoteOrderLinesDigest(lines),
        clientEmailRetryable: isClientEmailRetryable(review),
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

// El representante envía SU pedido a revisión con el correo del cliente al que irá la cotización
// aprobada. Reenviar el mismo pedido sin cambios no duplica nada; si agregó líneas mientras estaba
// pendiente, la revisión se actualiza y se avisa de nuevo (cambiar solo el correo no reavisa). Un pedido
// ya aprobado no se puede cambiar: hay que empezar otro. Si el cliente registrado no tenía correo, este
// queda en su ficha; si ya tenía uno, la ficha no cambia (un pedido puede ir a otro correo).
async function submitForReview(salespersonId: number, orderId: string, clientEmail: string, t: Translate) {
    const { review, lineCount, shouldNotify } = await lockedOrder(orderId, async transaction => {
        const lines = await loadQuoteOrderLines(orderId, { salespersonId }, transaction)
        if (!lines.length) throw notFound()
        // Cada línea necesita su peso neto antes de que gerencia pueda fijarle una ganancia por libra.
        buildOrderProfit(lines, 0)
        const linesDigest = quoteOrderLinesDigest(lines)
        const existing = await QuoteOrderReview.findOne({ where: { orderId }, transaction })
        if (existing && existing.salespersonId !== salespersonId) throw notFound()
        if (existing?.status === "approved") {
            if (existing.linesDigest !== linesDigest) throw new AppError(409, "errors.quote_review_already_approved")
            return { review: existing, lineCount: lines.length, shouldNotify: false }
        }
        const order = lines[0].record.breakdown?.order
        if (order?.clientId != null) await Client.update({ email: clientEmail }, { where: { id: order.clientId, email: null }, transaction })
        if (existing) {
            if (existing.linesDigest === linesDigest) {
                if (existing.clientEmail !== clientEmail) await existing.update({ clientEmail }, { transaction })
                return { review: existing, lineCount: lines.length, shouldNotify: false }
            }
            await existing.update({ linesDigest, clientEmail, notificationStatus: "pending" }, { transaction })
            return { review: existing, lineCount: lines.length, shouldNotify: true }
        }
        const created = await QuoteOrderReview.create({ orderId, salespersonId, clientId: order?.clientId ?? null, clientName: order?.clientName ?? "", clientEmail, linesDigest }, { transaction })
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

// Quién envió y quién aprobó: solo id y nombre.
const reviewPeople = [
    { model: Salesperson, as: "submittingSalesperson", attributes: ["id", "name"] },
    { model: User, as: "reviewingUser", attributes: ["id", "name"] },
]

async function listReviews(filters: ListQuoteReviewsQuery = {}) {
    return QuoteOrderReview.findAll({
        ...(filters.status ? { where: { status: filters.status } } : {}),
        include: reviewPeople,
        order: [["createdAt", "DESC"]],
    })
}

async function getReviewDetail(orderId: string) {
    const review = await QuoteOrderReview.findOne({ where: { orderId }, include: reviewPeople })
    if (!review) throw notFound()
    return detailView(review, await loadQuoteOrderLines(orderId, authorOf(review)))
}

// Gerencia prueba un monto por libra: calcula sobre las líneas actuales y no guarda nada.
async function previewReview(orderId: string, profitPerPound: number | string) {
    const review = await findReview(orderId)
    return pricingOf(await loadQuoteOrderLines(orderId, authorOf(review)), profitPerPound)
}

// Gerencia aprueba con el monto por libra y la huella de las líneas que vio. Si el pedido cambió
// desde entonces, se rechaza (409) para que revise lo actual. Repetir la misma aprobación (reintento
// de red) devuelve el mismo resultado; otra distinta sobre un pedido aprobado se rechaza.
// Con correo del cliente, la aprobación trae el PDF final y, ya confirmada, se le envía (copia al
// representante). Un reintento solo lo vuelve a enviar si el envío anterior no salió; dos simultáneos
// nunca lo envían dos veces (sendApprovedQuoteToClient toma el envío de forma atómica).
async function approveReview(orderId: string, input: QuoteReviewApproveInput, reviewedByUserId: number, pdf: QuoteReviewPdf | undefined, t: Translate) {
    const { review, lines } = await lockedOrder(orderId, async transaction => {
        const review = await findReview(orderId, transaction)
        if (review.clientEmail && !pdf) throw new AppError(422, "errors.quote_pdf_missing_file")
        const lines = await loadQuoteOrderLines(orderId, authorOf(review), transaction)
        const profitPerPound = parseProfitPerPound(input.profitPerPound)
        if (review.status === "approved") {
            const sameApproval = review.linesDigest === input.linesDigest && review.profitPerPound != null && profitPerPound.eq(review.profitPerPound)
            if (!sameApproval) throw new AppError(409, "errors.quote_review_already_approved")
            return { review, lines }
        }
        const linesDigest = quoteOrderLinesDigest(lines)
        if (input.linesDigest !== linesDigest) throw new AppError(409, "errors.quote_review_changed")
        const pricing = pricingOf(lines, profitPerPound.toString())
        await review.update({ status: "approved", linesDigest, profitPerPound: pricing.profitPerPound, pricing, reviewedByUserId, reviewedAt: new Date() }, { transaction })
        return { review, lines }
    })
    if (pdf) await sendApprovedQuoteToClient(review, pdf, t)
    return detailView(await review.reload(), lines)
}

// Reenvía al cliente la cotización aprobada cuyo envío falló (gerencia vuelve a generar el PDF).
async function resendClientEmail(orderId: string, pdf: QuoteReviewPdf, t: Translate) {
    const review = await findReview(orderId)
    if (review.status !== "approved") throw new AppError(409, "errors.quote_review_not_approved")
    if (!review.clientEmail) throw new AppError(409, "errors.quote_review_no_client_email")
    const clientEmailStatus = await sendApprovedQuoteToClient(review, pdf, t)
    if (!clientEmailStatus) throw new AppError(409, "errors.quote_review_client_email_already_sent")
    return { clientEmailStatus }
}

// Reenvía el aviso de un pedido pendiente (falló, faltaba configurar el destinatario o se perdió).
async function resendNotification(orderId: string, t: Translate) {
    const review = await findReview(orderId)
    if (review.status !== "pending") throw new AppError(409, "errors.quote_review_already_approved")
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
        const values = { status: "approved" as const, linesDigest: quoteOrderLinesDigest(lines), profitPerPound: pricing.profitPerPound, pricing, reviewedByUserId: userId, reviewedAt: new Date(), notificationStatus: "not_required" as const, clientEmailStatus: "not_required" as const }
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
    resendNotification,
    resendClientEmail,
    setAdminOrderPricing,
}
