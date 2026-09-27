import { Request, Response, NextFunction } from "express"
import { rawMaterialService } from "../services/rawMaterial.service"
import { RawMaterialQuery } from "../schemas/rawMaterial.schema"
import { AppError } from "../../../shared/errors/AppError"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as RawMaterialQuery
        const result = await rawMaterialService.listRawMaterials({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const rawMaterialId = Number(req.params.id)
        const rawMaterial = await rawMaterialService.getRawMaterialById(rawMaterialId)
        res.json({ data: rawMaterial })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const rawMaterial = await rawMaterialService.createRawMaterial(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.RawMaterial") }),
            data: rawMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const rawMaterialId = Number(req.params.id)
        const rawMaterial = await rawMaterialService.updateRawMaterial(rawMaterialId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.RawMaterial") }),
            data: rawMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const rawMaterialId = Number(req.params.id)
        await rawMaterialService.deleteRawMaterial(rawMaterialId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.RawMaterial") }) })
    } catch (error) {
        next(error)
    }
}

const EXCEL_MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-excel",
])

async function bulkImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.file) {
            throw new AppError(422, "errors.bulk_import_missing_file")
        }
        if (!EXCEL_MIME_TYPES.has(req.file.mimetype)) {
            throw new AppError(422, "errors.bulk_import_invalid_file_type")
        }
        const rawMaterials = await rawMaterialService.bulkImportRawMaterials(req.file.buffer)
        res.status(201).json({
            message: req.t("success.bulk_imported", { count: rawMaterials.length }),
            data: { created: rawMaterials.length }
        })
    } catch (error) {
        next(error)
    }
}

async function downloadTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await rawMaterialService.buildRawMaterialImportTemplate()
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", "attachment; filename=\"plantilla-materias-primas.xlsx\"")
        res.send(buffer)
    } catch (error) {
        next(error)
    }
}

export const rawMaterialController = {
    index,
    show,
    store,
    update,
    destroy,
    bulkImport,
    downloadTemplate,
}
