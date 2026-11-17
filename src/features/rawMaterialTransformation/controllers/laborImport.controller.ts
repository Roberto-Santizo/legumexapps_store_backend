import type { Request, Response, NextFunction } from "express"
import { AppError } from "../../../shared/errors/AppError"
import { LABOR_IMPORT_FILENAME } from "../constants/laborImport.constant"
import { laborImportService } from "../services/laborImport.service"

const handle = (operation: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response, next: NextFunction) => {
    try { await operation(req, res) }
    catch (error) { next(error) }
}

function file(req: Request) {
    if (!req.file) throw new AppError(422, "errors.bulk_import_missing_file")
    if (!req.file.originalname.toLowerCase().endsWith(".xlsx")) throw new AppError(422, "errors.bulk_import_invalid_xlsx")
    return req.file.buffer
}

export const laborImportController = {
    template: handle(async (_req, res) => {
        res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").attachment(LABOR_IMPORT_FILENAME).send(await laborImportService.template())
    }),
    preview: handle(async (req, res) => {
        const result = await laborImportService.plan(file(req))
        res.json({ data: {
            previewHash: result.previewHash, summary: result.summary,
            issues: result.issues.map(issue => ({ sheet: issue.sheet, row: issue.row, field: issue.field, message: req.t(issue.key, issue.params) })),
            templates: result.plans.map(entry => ({
                code: entry.input.code, displayName: entry.input.displayName, lineCode: entry.input.lineCode,
                positions: entry.input.positions.length, includedPositions: entry.calculation.includedPositions,
                monthlyCostGtq: entry.calculation.total.monthlyGtq, hourlyCostGtq: entry.calculation.total.hourlyGtq,
            })),
        } })
    }),
    confirm: handle(async (req, res) => {
        res.status(201).json({ message: req.t("success.labor_import_completed"), data: await laborImportService.confirm(file(req), typeof req.body?.previewHash === "string" ? req.body.previewHash : "", req.user!.id) })
    }),
}
