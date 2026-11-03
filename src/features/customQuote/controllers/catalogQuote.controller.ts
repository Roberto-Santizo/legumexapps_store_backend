import type { Request, Response, NextFunction } from "express"
import { z } from "zod"
import { representativeClientService } from "../../salesperson/services/representativeClient.service"
import { AppError } from "../../../shared/errors/AppError"
import { resolveContentLanguage } from "../../../shared/utils/translation.util"
import { discoverCatalog } from "../services/catalogQuoteDiscovery.service"
import { confirmCatalogQuote, previewCatalogQuote } from "../services/catalogQuote.service"
import { requireRepresentativeOrder } from "../../quoteOrder/services/representativeQuoteAccess.service"

const handle = (work: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.salesperson) throw new AppError(401, "errors.unauthenticated")
        res.status(status).json({ data: await work(req), message: req.t("success.created", { resource: req.t("resources.CustomQuote") }) })
    } catch (error) { next(error) }
}
export const catalogQuoteController = {
    catalog: handle(async req => {
        const clientId = req.query.clientId === undefined ? undefined : z.coerce.number().int().positive().parse(req.query.clientId)
        if (clientId && !(await representativeClientService.authorizedClientIds(req.salesperson!.id)).includes(clientId)) throw new AppError(403, "errors.forbidden")
        return discoverCatalog(resolveContentLanguage(req.language), clientId)
    }),
    preview: handle(async req => {
        if (req.body.clientId && !(await representativeClientService.authorizedClientIds(req.salesperson!.id)).includes(req.body.clientId)) throw new AppError(403, "errors.forbidden")
        return previewCatalogQuote(req.salesperson!.id, req.body, resolveContentLanguage(req.language))
    }),
    confirm: handle(async req => {
        const order = await requireRepresentativeOrder(req.salesperson!.id, req.body.order, false)
        return confirmCatalogQuote(req.salesperson!.id, { ...req.body, order }, resolveContentLanguage(req.language))
    }, 201),
}
