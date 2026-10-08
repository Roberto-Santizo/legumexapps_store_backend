import type { AdminQuoteListQuery } from "../schemas/adminQuoteList.schema"
import { Request, Response, NextFunction } from "express"
import { AppError } from "../../../shared/errors/AppError"
import { quoteService } from "../services/quote.service"
import { emailService } from "../../../shared/services/email.service"
import { resolveContentLanguage } from "../../../shared/utils/translation.util"
import { SalespersonQuoteInput, SendQuotePdfEmailInput } from "../schemas/quote.schema"
import { quoteDraftService } from "../../quoteDraft/services/quoteDraft.service"

async function save(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.salesperson) throw new AppError(401, "errors.unauthenticated")
        const quote = await quoteService.saveQuote(req.salesperson.id, req.body, resolveContentLanguage(req.language))
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
        const data = await quoteService.listQuotableProducts(resolveContentLanguage(req.language))
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
        const calculation = await quoteService.calculateQuote(calculationInput, resolveContentLanguage(req.language))

        if (draftKey) {
            try {
                await quoteDraftService.upsertFromCalculation(req.salesperson.id, draftKey, calculationInput, calculation)
            } catch (draftError) {
                console.error("[quoteDraft] no se pudo registrar el borrador", draftError)
            }
        }

        res.json({ data: calculation })
    } catch (error) {
        next(error)
    }
}



async function sendPdfEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {

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

        res.json({ message: req.t("success.quote_pdf_email_sent") })
    } catch (error) {
        next(error)
    }
}

export const quoteController = {
    products,
    destinations,
    save,
    indexAll,
    preview,
    previewAndTrackDraft,
    sendPdfEmail,
}
