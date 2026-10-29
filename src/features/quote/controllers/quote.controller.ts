import type { AdminQuoteListQuery } from "../schemas/adminQuoteList.schema"
import { Request, Response, NextFunction } from "express"
import { AppError } from "../../../shared/errors/AppError"
import { fixedQuoteService as quoteService } from "../services/fixedQuote.service"
import { emailService } from "../../../shared/services/email.service"
import { resolveContentLanguage } from "../../../shared/utils/translation.util"
import { AdminSaveQuoteInput, AdminSendQuotePdfEmailInput, SalespersonQuoteInput, SendQuotePdfEmailInput } from "../schemas/quote.schema"
import { resolveAdminQuoteOrder } from "../../quoteOrder/services/adminQuoteOrder.service"
import { quoteDraftService } from "../../quoteDraft/services/quoteDraft.service"
import { listProductionOrders } from "../services/productionOrder.service"
import { representativeClientService } from "../../salesperson/services/representativeClient.service"
import { requireRepresentativeVariantAccess, requireRepresentativeOrder } from "../../quoteOrder/services/representativeQuoteAccess.service"
import { representativeQuoteView } from "../../pricing/services/representativeQuoteView"

async function productionOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json({ data: await listProductionOrders(req.query as AdminQuoteListQuery) }) }
    catch (error) { next(error) }
}

async function save(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.salesperson) throw new AppError(401, "errors.unauthenticated")
        req.body.order = await requireRepresentativeOrder(req.salesperson.id, req.body.order, true)
        await requireRepresentativeVariantAccess(req.salesperson.id, req.body.productVariantId, req.body.order?.clientId)
        const quote = await quoteService.saveQuote(req.salesperson.id, req.body, resolveContentLanguage(req.language))
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.Quote") }),
            data: representativeQuoteView(quote)
        })
    } catch (error) {
        next(error)
    }
}

// POST /admin/quotes (staff, quotes:calculate): guarda la cotización a nombre del usuario staff. Mismo
// recálculo y snapshot que el representante; el cliente del pedido lo resuelve el servidor.
async function saveAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.user) throw new AppError(401, "errors.unauthenticated")
        const { orderId, ...input } = req.body as AdminSaveQuoteInput
        const order = await resolveAdminQuoteOrder(orderId, input.productVariantId)
        const quote = await quoteService.saveAdminQuote(req.user.id, { ...input, order }, resolveContentLanguage(req.language))
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.Quote") }),
            data: quote
        })
    } catch (error) {
        next(error)
    }
}

async function products(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        let clientIds: number[] | undefined
        if (req.salesperson) {
            const clientId = typeof req.query.clientId === "string" && /^[1-9]\d*$/.test(req.query.clientId) ? Number(req.query.clientId) : NaN
            if (!Number.isSafeInteger(clientId)) throw new AppError(400, "errors.quote_client_required")
            const assigned = await representativeClientService.authorizedClientIds(req.salesperson.id)
            if (!assigned.includes(clientId)) throw new AppError(403, "errors.forbidden")
            clientIds = [clientId]
        }
        const language = resolveContentLanguage(req.language)
        const data = clientIds === undefined ? await quoteService.listQuotableProducts(language) : await quoteService.listQuotableProducts(language, clientIds)
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

async function destinations(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const data = await quoteService.listQuoteDestinations()
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

async function representativeDestinations(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        res.json({ data: await quoteService.listRepresentativeDestinations() })
    } catch (error) {
        next(error)
    }
}

async function indexAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const data = await quoteService.listAllQuotes(req.query as AdminQuoteListQuery)
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

// SOLO /admin/quotes/preview (staff, quotes:calculate): calcula (calculateQuote) y NUNCA persiste
// nada -- ni Quote (saveQuote) ni borradores (quoteDraft/). Garantía estructural, no convención.
async function preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const calculation = await quoteService.calculateQuote(req.body, resolveContentLanguage(req.language))
        res.json({ data: calculation })
    } catch (error) {
        next(error)
    }
}

// /quotes/preview (representante, recálculo en vivo del wizard): mismo cálculo y MISMA respuesta que
// `preview`, nunca llama a saveQuote. Además, si el wizard mandó draftKey, registra el borrador
// (quoteDraftService.upsertFromCalculation) -- solo después de un cálculo exitoso (una config inválida
// tira antes y no escribe nada). El seguimiento es best-effort: si la escritura del borrador falla, se
// loguea y el total en vivo se devuelve igual.
async function previewAndTrackDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.salesperson) throw new AppError(401, "errors.unauthenticated")
        const { draftKey, ...calculationInput } = req.body as SalespersonQuoteInput
        calculationInput.order = await requireRepresentativeOrder(req.salesperson.id, calculationInput.order, true)
        await requireRepresentativeVariantAccess(req.salesperson.id, calculationInput.productVariantId, calculationInput.order?.clientId!)
        const calculation = await quoteService.calculateQuote(calculationInput, resolveContentLanguage(req.language))

        if (draftKey) {
            try {
                await quoteDraftService.upsertFromCalculation(req.salesperson.id, draftKey, calculationInput, calculation)
            } catch (draftError) {
                console.error("[quoteDraft] no se pudo registrar el borrador; detalles sensibles omitidos")
            }
        }

        res.json({ data: representativeQuoteView(calculation) })
    } catch (error) {
        next(error)
    }
}



async function sendPdfEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        await sendAttachedPdf(req)
        res.json({ message: req.t("success.quote_pdf_email_sent") })
    } catch (error) {
        next(error)
    }
}

// Cotizador del admin: con quoteIds, el envío queda registrado en esas cotizaciones (destinatario, correo,
// quién y cuándo). Se comprueba que existan ANTES de enviar; el registro se escribe solo si el correo salió.
async function sendAdminPdfEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.user) throw new AppError(401, "errors.unauthenticated")
        const { to, recipientName, quoteIds } = req.body as AdminSendQuotePdfEmailInput
        if (quoteIds) await quoteService.assertQuotesExist(quoteIds)
        await sendAttachedPdf(req)
        if (quoteIds && recipientName) {
            await quoteService.recordEmailDelivery(quoteIds, { recipientName, recipientEmail: to, sentByUserId: req.user.id, sentAt: new Date().toISOString() })
        }
        res.json({ message: req.t("success.quote_pdf_email_sent") })
    } catch (error) {
        next(error)
    }
}

async function sendAttachedPdf(req: Request): Promise<void> {
    if (!req.file) {
        throw new AppError(422, "errors.quote_pdf_missing_file")
    }
    if (req.file.mimetype !== "application/pdf") {
        throw new AppError(422, "errors.quote_pdf_invalid_file_type")
    }

    const { to, subject, body } = req.body as SendQuotePdfEmailInput
    await emailService.sendMailWithAttachment({
        to,
        subject,
        textBody: body,
        attachment: {
            buffer: req.file.buffer,
            fileName: req.file.originalname || "cotizacion.pdf",
            contentType: "application/pdf"
        }
    })
}

async function clients(req: Request, res: Response, next: NextFunction) {
    try {
        if (!req.salesperson) throw new AppError(401, "errors.unauthenticated")
        res.json({ data: await representativeClientService.authorizedClients(req.salesperson.id) })
    } catch (error) { next(error) }
}

export const quoteController = {
    clients,
    productionOrders,
    products,
    destinations,
    representativeDestinations,
    save,
    saveAdmin,
    indexAll,
    preview,
    previewAndTrackDraft,
    sendPdfEmail,
    sendAdminPdfEmail,
}
