import { Request, Response, NextFunction } from "express"
import { productRawMaterialService } from "../services/productRawMaterial.service"
import { productRawMaterialImportService } from "../services/productRawMaterialImport.service"
import { AppError } from "../../../shared/errors/AppError"

async function index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productRawMaterials = await productRawMaterialService.listProductRawMaterials()
        res.json({ data: productRawMaterials })
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productRawMaterialId = Number(req.params.id)
        const productRawMaterial = await productRawMaterialService.getProductRawMaterialById(productRawMaterialId)
        res.json({ data: productRawMaterial })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productRawMaterial = await productRawMaterialService.createProductRawMaterial(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.ProductRawMaterial") }),
            data: productRawMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productRawMaterialId = Number(req.params.id)
        const productRawMaterial = await productRawMaterialService.updateProductRawMaterial(productRawMaterialId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.ProductRawMaterial") }),
            data: productRawMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productRawMaterialId = Number(req.params.id)
        await productRawMaterialService.deleteProductRawMaterial(productRawMaterialId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.ProductRawMaterial") }) })
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
        const productRawMaterials = await productRawMaterialImportService.bulkImportProductRawMaterials(req.file.buffer)
        res.status(201).json({
            message: req.t("success.bulk_imported", { count: productRawMaterials.length }),
            data: { created: productRawMaterials.length }
        })
    } catch (error) {
        next(error)
    }
}

async function downloadTemplate(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await productRawMaterialImportService.buildProductRawMaterialImportTemplate()
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", "attachment; filename=\"plantilla-recetas.xlsx\"")
        res.send(buffer)
    } catch (error) {
        next(error)
    }
}

export const productRawMaterialController = {
    index,
    show,
    store,
    update,
    destroy,
    bulkImport,
    downloadTemplate,
}
