import type { Request, Response, NextFunction } from "express"
import { resolveContentLanguage } from "../../../shared/utils/translation.util"
import { discoverCatalog } from "../services/catalogQuoteDiscovery.service"
import { previewAdminCatalogQuote } from "../services/catalogQuote.service"

// Mounted behind staff authentication and quotes:calculate; no save/confirm action is exposed.
export const adminCatalogQuoteController = {
    async catalog(req: Request, res: Response, next: NextFunction) {
        try { res.json({ data: await discoverCatalog(resolveContentLanguage(req.language)) }) }
        catch (error) { next(error) }
    },
    async preview(req: Request, res: Response, next: NextFunction) {
        try { res.json({ data: await previewAdminCatalogQuote(req.body, resolveContentLanguage(req.language)) }) }
        catch (error) { next(error) }
    },
}
