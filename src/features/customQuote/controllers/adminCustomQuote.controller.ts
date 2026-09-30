import { Request, Response, NextFunction } from "express"
import { adminCustomQuoteService } from "../services/adminCustomQuote.service"
import { ListCustomQuotesQuery, UpdateCustomQuoteStatusInput } from "../schemas/adminCustomQuote.schema"
import { resolveContentLanguage } from "../../../shared/utils/translation.util"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { startDate, endDate, status } = req.query as unknown as ListCustomQuotesQuery
        const data = await adminCustomQuoteService.listCustomQuotes({ startDate, endDate, status }, resolveContentLanguage(req.language))
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const data = await adminCustomQuoteService.getCustomQuoteById(Number(req.params.id), resolveContentLanguage(req.language))
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { status } = req.body as UpdateCustomQuoteStatusInput
        const data = await adminCustomQuoteService.setCustomQuoteStatus(Number(req.params.id), status)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.CustomQuote") }),
            data
        })
    } catch (error) {
        next(error)
    }
}

export const adminCustomQuoteController = {
    index,
    show,
    updateStatus,
}
