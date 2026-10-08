import { Request, Response, NextFunction } from "express"
import { packagingService } from "../services/packaging.service"
import { PackagingQuery } from "../schemas/packaging.schema"
import { AppError } from "../../../shared/errors/AppError"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as PackagingQuery
        const result = await packagingService.listPackagings({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const packagingId = Number(req.params.id)
        const packaging = await packagingService.getPackagingById(packagingId)
        res.json({ data: packaging })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const packaging = await packagingService.createPackaging(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.Packaging") }),
            data: packaging
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const packagingId = Number(req.params.id)
        const packaging = await packagingService.updatePackaging(packagingId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Packaging") }),
            data: packaging
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const packagingId = Number(req.params.id)
        await packagingService.deletePackaging(packagingId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.Packaging") }) })
    } catch (error) {
        next(error)
    }
}

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
        const packagings = await packagingService.bulkImportPackagings(req.file.buffer)
        res.status(201).json({
            message: req.t("success.bulk_imported", { count: packagings.length }),
            data: { created: packagings.length }
        })
    } catch (error) {
        next(error)
    }
}

async function downloadTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await packagingService.buildPackagingImportTemplate()
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", "attachment; filename=\"plantilla-empaques.xlsx\"")
        res.send(buffer)
    } catch (error) {
        next(error)
    }
}

export const packagingController = {
    index,
    show,
    store,
    update,
    destroy,
    bulkImport,
    downloadTemplate,
}
