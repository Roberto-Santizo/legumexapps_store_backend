import { Request, Response, NextFunction } from "express"
import { ValidationError as SequelizeValidationError, UniqueConstraintError } from "sequelize"
import { ZodError } from "zod"
import { MulterError } from "multer"
import { AppError, BulkImportError } from "../errors/AppError"

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {

    if (error instanceof MulterError) {
        const key = error.code === "LIMIT_FILE_SIZE" ? "errors.bulk_import_file_too_large" : "errors.bulk_import_upload_error"
        res.status(422).json({ message: req.t(key) })
        return
    }


    if (error instanceof BulkImportError) {
        res.status(error.statusCode).json({
            message: req.t(error.key),
            details: error.rowIssues.map(issue => ({
                row: issue.row,
                field: issue.field,
                message: req.t(issue.key, issue.params)
            }))
        })
        return
    }

    if (error instanceof AppError) {
        const resource = error.params?.resource
        const params = resource
            ? { ...error.params, resource: req.t(`resources.${resource}`, { defaultValue: resource }) }
            : error.params
        res.status(error.statusCode).json({ message: req.t(error.key, params) })
        return
    }

    if (error instanceof ZodError) {
        res.status(400).json({
            message: req.t("errors.validation"),
            details: error.issues.map(issue => ({
                path: issue.path.join("."),
                message: req.t(`errors.zod.${issue.code}`, { defaultValue: issue.message })
            }))
        })
        return
    }

    if (error instanceof UniqueConstraintError) {
        res.status(409).json({
            message: req.t("errors.unique_constraint"),
            details: error.errors.map(validationErrorItem => validationErrorItem.message)
        })
        return
    }

    if (error instanceof SequelizeValidationError) {
        res.status(400).json({
            message: req.t("errors.validation"),
            details: error.errors.map(validationErrorItem => validationErrorItem.message)
        })
        return
    }

    console.error(error)
    res.status(500).json({ message: req.t("errors.internal") })
}
