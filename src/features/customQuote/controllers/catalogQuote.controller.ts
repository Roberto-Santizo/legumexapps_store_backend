import type { Request, Response, NextFunction } from "express"
import { AppError } from "../../../shared/errors/AppError"
import { resolveContentLanguage } from "../../../shared/utils/translation.util"
import { discoverCatalog } from "../services/catalogQuoteDiscovery.service"
import { confirmCatalogQuote, previewCatalogQuote } from "../services/catalogQuote.service"

const handle = (work: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.salesperson) throw new AppError(401, "errors.unauthenticated")
        res.status(status).json({ data: await work(req), message: req.t("success.created", { resource: req.t("resources.CustomQuote") }) })
    } catch (error) { next(error) }
}
export const catalogQuoteController = {
    catalog: handle(req => discoverCatalog(resolveContentLanguage(req.language))),
    preview: handle(req => previewCatalogQuote(req.salesperson!.id, req.body, resolveContentLanguage(req.language))),
    confirm: handle(req => confirmCatalogQuote(req.salesperson!.id, req.body, resolveContentLanguage(req.language)), 201),
}
