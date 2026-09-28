import { Request, Response, NextFunction } from "express"
import { productIngredientService } from "../services/productIngredient.service"
import { productIngredientImportService } from "../services/productIngredientImport.service"
import { AppError } from "../../../shared/errors/AppError"

async function index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredients = await productIngredientService.listProductIngredients()
        res.json({ data: productIngredients })
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredientId = Number(req.params.id)
        const productIngredient = await productIngredientService.getProductIngredientById(productIngredientId)
        res.json({ data: productIngredient })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredient = await productIngredientService.createProductIngredient(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.ProductIngredient") }),
            data: productIngredient
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredientId = Number(req.params.id)
        const productIngredient = await productIngredientService.updateProductIngredient(productIngredientId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.ProductIngredient") }),
            data: productIngredient
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredientId = Number(req.params.id)
        await productIngredientService.deleteProductIngredient(productIngredientId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.ProductIngredient") }) })
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
        const productIngredients = await productIngredientImportService.bulkImportProductIngredients(req.file.buffer)
        res.status(201).json({
            message: req.t("success.bulk_imported", { count: productIngredients.length }),
            data: { created: productIngredients.length }
        })
    } catch (error) {
        next(error)
    }
}

async function downloadTemplate(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await productIngredientImportService.buildProductIngredientImportTemplate()
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", "attachment; filename=\"plantilla-ingredientes-producto.xlsx\"")
        res.send(buffer)
    } catch (error) {
        next(error)
    }
}

export const productIngredientController = {
    index,
    show,
    store,
    update,
    destroy,
    bulkImport,
    downloadTemplate,
}
