import { Request, Response, NextFunction } from "express"
import { AppError } from "../../../shared/errors/AppError"
import { quoteService } from "../services/quote.service"
import { emailService } from "../../../shared/services/email.service"
import { resolveContentLanguage } from "../../../shared/utils/translation.util"
import { SendQuotePdfEmailInput } from "../schemas/quote.schema"

async function save(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.customer) throw new AppError(401, "errors.unauthenticated")
        const quote = await quoteService.saveQuote(req.customer.id, req.body, resolveContentLanguage(req.language))
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

async function indexAll(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const data = await quoteService.listAllQuotes()
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

async function previewForAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const calculation = await quoteService.calculateQuote(req.body, resolveContentLanguage(req.language))
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
    previewForAdmin,
    sendPdfEmail,
}
