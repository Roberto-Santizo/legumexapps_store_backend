import { Request, Response, NextFunction } from "express"
import { productVariantService } from "../services/productVariant.service"
import { productVariantImportService } from "../services/productVariantImport.service"
import { AppError } from "../../../shared/errors/AppError"

async function index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariants = await productVariantService.listProductVariants()
        res.json({ data: productVariants })
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantId = Number(req.params.id)
        const productVariant = await productVariantService.getProductVariantById(productVariantId)
        res.json({ data: productVariant })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariant = await productVariantService.createProductVariant(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.ProductVariant") }),
            data: productVariant
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantId = Number(req.params.id)
        const productVariant = await productVariantService.updateProductVariant(productVariantId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.ProductVariant") }),
            data: productVariant
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantId = Number(req.params.id)
        await productVariantService.deleteProductVariant(productVariantId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.ProductVariant") }) })
    } catch (error) {
        next(error)
    }
}

// Autofill del SKU (2026-09-13) -- solo lectura, ver productVariantService.findVariantConfigBySkuCode.
async function lookupBySkuCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const skuCode = String(req.params.skuCode)
        const config = await productVariantService.findVariantConfigBySkuCode(skuCode)
        res.json({ data: config })
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
        const productVariants = await productVariantImportService.bulkImportProductVariants(req.file.buffer)
        res.status(201).json({
            message: req.t("success.bulk_imported", { count: productVariants.length }),
            data: { created: productVariants.length }
        })
    } catch (error) {
        next(error)
    }
}

async function downloadTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await productVariantImportService.buildProductVariantImportTemplate()
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", "attachment; filename=\"plantilla-skus.xlsx\"")
        res.send(buffer)
    } catch (error) {
        next(error)
    }
}

export const productVariantController = {
    index,
    show,
    store,
    update,
    destroy,
    lookupBySkuCode,
    bulkImport,
    downloadTemplate,
}
