import { Request, Response, NextFunction } from "express"
import { AppError } from "../../../shared/errors/AppError"
import { quoteReviewService } from "../services/quoteReview.service"
import type { ListQuoteReviewsQuery, QuoteReviewApproveInput, QuoteReviewPreviewInput, QuoteReviewSubmitInput } from "../schemas/quoteReview.schema"
import type { QuoteReviewPdf } from "../services/quoteReviewClientEmail"

// PDF adjunto (multipart, campo "file"): solo application/pdf.
function attachedPdf(req: Request): QuoteReviewPdf | undefined {
    if (!req.file) return undefined
    if (req.file.mimetype !== "application/pdf") throw new AppError(422, "errors.quote_pdf_invalid_file_type")
    return { buffer: req.file.buffer, fileName: req.file.originalname || "cotizacion.pdf" }
}

// Representante: enviar su pedido a revisión y consultar el estado (precio final una vez aprobado).
async function submit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.salesperson) throw new AppError(401, "errors.unauthenticated")
        const { clientEmail } = req.body as QuoteReviewSubmitInput
        const data = await quoteReviewService.submitForReview(req.salesperson.id, String(req.params.orderId), clientEmail, req.t)
        res.status(201).json({ message: req.t("success.quote_review_submitted"), data })
    } catch (error) {
        next(error)
    }
}

async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.salesperson) throw new AppError(401, "errors.unauthenticated")
        res.json({ data: await quoteReviewService.getRepresentativeReview(req.salesperson.id, String(req.params.orderId)) })
    } catch (error) {
        next(error)
    }
}

// Gerencia (quotes:review).
async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        res.json({ data: await quoteReviewService.listReviews(req.query as ListQuoteReviewsQuery) })
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        res.json({ data: await quoteReviewService.getReviewDetail(String(req.params.orderId)) })
    } catch (error) {
        next(error)
    }
}

async function preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { profitPerPound } = req.body as QuoteReviewPreviewInput
        res.json({ data: await quoteReviewService.previewReview(String(req.params.orderId), profitPerPound) })
    } catch (error) {
        next(error)
    }
}

async function approve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.user) throw new AppError(401, "errors.unauthenticated")
        const data = await quoteReviewService.approveReview(String(req.params.orderId), req.body as QuoteReviewApproveInput, req.user.id, attachedPdf(req), req.t)
        res.json({ message: req.t("success.quote_review_approved"), data })
    } catch (error) {
        next(error)
    }
}

async function notify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        res.json({ data: await quoteReviewService.resendNotification(String(req.params.orderId), req.t) })
    } catch (error) {
        next(error)
    }
}

// Reenvío al cliente de una cotización aprobada cuyo correo falló: llega el PDF regenerado.
async function clientEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const pdf = attachedPdf(req)
        if (!pdf) throw new AppError(422, "errors.quote_pdf_missing_file")
        res.json({ data: await quoteReviewService.resendClientEmail(String(req.params.orderId), pdf, req.t) })
    } catch (error) {
        next(error)
    }
}

// Calculadora del admin (quotes:calculate): su propia ganancia, sin revisión.
async function adminPricing(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.user) throw new AppError(401, "errors.unauthenticated")
        const { profitPerPound } = req.body as QuoteReviewPreviewInput
        res.json({ data: await quoteReviewService.setAdminOrderPricing(String(req.params.orderId), profitPerPound, req.user.id) })
    } catch (error) {
        next(error)
    }
}

export const quoteReviewController = {
    submit,
    status,
    index,
    show,
    preview,
    approve,
    notify,
    clientEmail,
    adminPricing,
}
