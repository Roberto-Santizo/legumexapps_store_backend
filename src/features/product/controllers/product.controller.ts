import {Request, Response, NextFunction} from "express"
import {productService} from "../services/product.service"
import { ProductQuery } from "../schemas/product.schema"
import { productImportService } from "../services/productImport.service"
import { AppError, ExcelImportParseError } from "../../../shared/errors/AppError"
import { validateXlsxBuffer } from "../../../shared/utils/excelImport.util"


async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const { page, limit, search } = req.query as unknown as ProductQuery
        const result = await productService.listProducts({ page, limit }, search)
        res.json(result)
    }catch(error){
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const productId = Number(req.params.id)
        const product = await productService.getProductById(productId)
        res.json({data: product})
    }catch(error){
        next(error)
    }
}

async function store(req:Request, res:Response, next: NextFunction): Promise<void> {
    try{
        const product = await productService.createProduct(req.body)
        res.status(201).json({
            message: req.t("success.created", {resource: req.t("resources.Product")}),
            data: product
        })
    }catch(error){
        next(error)
    }
}

async function update(req:Request, res:Response, next:NextFunction): Promise<void>{
    try{
        const productId = Number(req.params.id)
        const product = await productService.updateProduct(productId, req.body)
        res.json({
            message: req.t("success.updated", {resource: req.t("resources.Product")}),
            data: product
        })

    }catch(error){
        next(error)
    }
}

async function destroy(req:Request, res:Response, next:NextFunction): Promise<void>{
    try{
        const productId = Number(req.params.id)
        await productService.deleteProduct(productId)
        res.json({message: req.t("success.deleted", {resource: req.t("resources.Product")})})

    }catch(error){
        next(error)
    }
}

async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productId = Number(req.params.id)
        const { isActive } = req.body
        const product = await productService.setProductStatus(productId, isActive)
        res.json({
            message: req.t(isActive ? "success.activated" : "success.deactivated", { resource: req.t("resources.Product") }),
            data: product
        })
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
        const result = await productImportService.bulkImportProducts(req.file.buffer)
        res.status(201).json({
            message: req.t("success.bulk_imported", { count: result.variants }),
            data: { created: result.variants, productsCreated: result.products, variantsCreated: result.variants }
        })
    } catch (error) {
        next(error)
    }
}

function initialImportFile(req: Request): Buffer {
    if (!req.file) throw new AppError(422, "errors.bulk_import_missing_file")
    // Browsers may send an empty or generic MIME; the extension and actual bytes
    // remain mandatory. A definite non-Excel MIME is rejected.
    const allowedMimeTypes = new Set([...EXCEL_MIME_TYPES, "", "application/octet-stream", "application/zip", "application/x-zip-compressed"])
    if (typeof req.file.originalname !== "string" || !req.file.originalname.toLowerCase().endsWith(".xlsx") || !allowedMimeTypes.has(req.file.mimetype)) throw new AppError(422, "errors.bulk_import_invalid_xlsx")
    validateXlsxBuffer(req.file.buffer)
    if (req.file.size !== req.file.buffer.length) throw new AppError(422, "errors.bulk_import_invalid_xlsx")
    return req.file.buffer
}

async function previewImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const preview = await productImportService.previewProductImport(initialImportFile(req))
        const translate = (issue: { row: number; field: string; key: string; sheet?: string; params?: Record<string, unknown> }) => ({ row: issue.row, field: issue.field, sheet: issue.sheet, message: req.t(issue.key, issue.params ?? {}) })
        res.json({ message: req.t("packagingAssociationImport.preview_ready"), data: { ...preview,
            issues: preview.issues.map(translate), materials: preview.materials.map(row => ({ ...row,
                consumptionRule: row.quantity == null ? req.t(row.level === "intermediate" ? "packagingAssociationImport.rules.variant" : "packagingAssociationImport.rules.missing") : req.t(`packagingAssociationImport.rules.${row.quantityBasis}`, { quantity: row.quantity }),
                issues: row.issues.map(translate), warnings: row.warnings.map(translate),
            })),
        } })
    } catch (error) {
        if (error instanceof ExcelImportParseError && process.env.NODE_ENV === "development") {
            console.debug("Excel import upload metadata", {
                filePresent: Boolean(req.file), bufferPresent: req.file?.buffer !== undefined,
                isBuffer: Buffer.isBuffer(req.file?.buffer), bufferLength: req.file?.buffer?.length,
                originalname: req.file?.originalname, mimetype: req.file?.mimetype, size: req.file?.size,
            })
        }
        next(error)
    }
}

async function confirmImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const summary = await productImportService.confirmProductImport(initialImportFile(req), String(req.body.previewHash ?? ""))
        res.status(201).json({ message: req.t("success.bulk_imported", { count: summary.variants }), data: summary })
    } catch (error) {
        if (["40001", "40P01"].includes((error as { original?: { code?: string } }).original?.code ?? "")) next(new AppError(409, "errors.packaging_association_import.stale_preview"))
        else next(error)
    }
}

async function downloadTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await productImportService.buildProductImportTemplate(["sheets", "references", "groups", "rules", "other", "intermediate", "compatibility", "catalog", "after"].map(key => req.t(`initialProductImport.instructions.${key}`)))
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", "attachment; filename=\"plantilla-productos.xlsx\"")
        res.send(buffer)
    } catch (error) {
        next(error)
    }
}

export const productController = {
    index,
    show,
    store,
    update,
    destroy,
    updateStatus,
    bulkImport,
    previewImport,
    confirmImport,
    downloadTemplate,
}
