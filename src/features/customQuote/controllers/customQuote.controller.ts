import { Request, Response, NextFunction } from "express"
import { customQuoteService } from "../services/customQuote.service"
import { customQuoteCatalogService } from "../services/customQuoteCatalog.service"
import { resolveContentLanguage } from "../../../shared/utils/translation.util"
import { AppError } from "../../../shared/errors/AppError"

async function catalog(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const data = await customQuoteCatalogService.getCatalog(resolveContentLanguage(req.language))
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

// Solo calcula: no guarda nada (ni una cotización a la medida ni un borrador). Guardar es POST / (save).
async function preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const data = await customQuoteService.calculateCustomQuote(req.body, resolveContentLanguage(req.language))
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

// Recalcula en el servidor y guarda en customQuotes, a nombre del representante del JWT.
async function save(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.salesperson) throw new AppError(401, "errors.unauthenticated")
        const data = await customQuoteService.saveCustomQuote(req.salesperson.id, req.body, resolveContentLanguage(req.language))
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.CustomQuote") }),
            data
        })
    } catch (error) {
        next(error)
    }
}

export const customQuoteController = {
    catalog,
    preview,
    save,
}
