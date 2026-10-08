import { Request, Response, NextFunction } from "express"
import { AppError } from "../../../shared/errors/AppError"
import { clientImportService } from "../services/clientImport.service"

const EXCEL_MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-excel", // .xls
])

async function bulkImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.file) {
            throw new AppError(422, "errors.bulk_import_missing_file")
        }
        if (!EXCEL_MIME_TYPES.has(req.file.mimetype)) {
            throw new AppError(422, "errors.bulk_import_invalid_file_type")
        }
        const clients = await clientImportService.bulkImportClients(req.file.buffer)
        res.status(201).json({
            message: req.t("success.bulk_imported", { count: clients.length }),
            data: { created: clients.length }
        })
    } catch (error) {
        next(error)
    }
}

async function downloadTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await clientImportService.buildClientImportTemplate([
            req.t("clientImport.instructions.fields"), req.t("clientImport.instructions.rules"), req.t("clientImport.instructions.example"),
        ])
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", "attachment; filename=\"plantilla-clientes.xlsx\"")
        res.send(buffer)
    } catch (error) {
        next(error)
    }
}

export const clientImportController = { bulkImport, downloadTemplate }
