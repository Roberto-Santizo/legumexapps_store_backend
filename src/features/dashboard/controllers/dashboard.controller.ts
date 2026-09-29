import { Request, Response, NextFunction } from "express"
import { dashboardService } from "../services/dashboard.service"
import { DashboardSummaryQuery } from "../schemas/dashboard.schema"
import { resolveContentLanguage } from "../../../shared/utils/translation.util"

async function summary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { startDate, endDate } = req.query as unknown as DashboardSummaryQuery
        const data = await dashboardService.getSummary(startDate, endDate, resolveContentLanguage(req.language))
        res.json({ data })
    } catch (error) {
        next(error)
    }
}

export const dashboardController = {
    summary,
}
