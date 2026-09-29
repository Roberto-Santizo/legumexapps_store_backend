import { Request, Response, NextFunction } from "express"
import { quoteDraftService } from "../services/quoteDraft.service"
import { ListQuoteDraftsQuery } from "../schemas/quoteDraft.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { startDate, endDate } = req.query as unknown as ListQuoteDraftsQuery
        const data = await quoteDraftService.listDrafts(startDate, endDate)
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

export const quoteDraftController = {
    index,
}
