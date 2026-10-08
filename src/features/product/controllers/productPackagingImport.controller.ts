import { Request, Response, NextFunction } from "express"
import { AppError } from "../../../shared/errors/AppError"
import { productPackagingImportService } from "../services/productPackagingImport.service"

function fileBuffer(req: Request): Buffer {
    if (!req.file) throw new AppError(422, "errors.bulk_import_missing_file")
    if (!req.file.originalname.toLowerCase().endsWith(".xlsx") || ![
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream",
    ].includes(req.file.mimetype)) throw new AppError(422, "errors.bulk_import_invalid_file_type")
    return req.file.buffer
}

async function preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const result = await productPackagingImportService.previewProductPackagingImport(fileBuffer(req))
        const rows = result.rows.map(row => ({ ...row,
            consumptionRule: row.quantity == null ? req.t(row.level === "intermediate" ? "packagingAssociationImport.rules.variant" : "packagingAssociationImport.rules.missing")
                : req.t(`packagingAssociationImport.rules.${row.quantityBasis}`, { quantity: row.quantity }),
            issues: row.issues.map(issue => ({ row: issue.row, field: issue.field, message: req.t(issue.key, issue.params ?? {}) })),
            warnings: row.warnings.map(issue => ({ row: issue.row, field: issue.field, message: req.t(issue.key, issue.params ?? {}) })),
        }))
        res.json({ message: req.t("packagingAssociationImport.preview_ready"), data: { ...result, rows } })
    } catch (error) { next(error) }
}

async function confirm(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const result = await productPackagingImportService.confirmProductPackagingImport(fileBuffer(req), String(req.body.previewHash ?? ""))
        res.json({ message: req.t("packagingAssociationImport.imported", { count: result.new + result.update }), data: result })
    } catch (error) {
        // PostgreSQL serializable conflicts are safe rollbacks; the user must revalidate.
        if (["40001", "40P01"].includes((error as { original?: { code?: string } }).original?.code ?? "")) next(new AppError(409, "errors.packaging_association_import.stale_preview"))
        else next(error)
    }
}

async function downloadTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await productPackagingImportService.buildProductPackagingImportTemplate(
            ["codes", "groups", "unit", "intermediate", "pallet", "legacy", "costs", "limits"].map(key => req.t(`packagingAssociationImport.instructions.${key}`))
        )
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", 'attachment; filename="plantilla-materiales-por-variante.xlsx"')
        res.send(buffer)
    } catch (error) { next(error) }
}

export const productPackagingImportController = { preview, confirm, downloadTemplate }
