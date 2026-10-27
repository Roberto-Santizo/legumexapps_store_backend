import { Request, Response, NextFunction } from "express"
import { ValidationError as SequelizeValidationError, UniqueConstraintError, DatabaseError } from "sequelize"
import { ZodError } from "zod"
import { MulterError } from "multer"
import { AppError, BulkImportError, ExcelImportParseError } from "../errors/AppError"

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
                ...(issue.sheet ? { sheet: issue.sheet } : {}),
                row: issue.row,
                field: issue.field,
                message: req.t(issue.key, issue.params)
            }))
        })
        return
    }

    if (error instanceof AppError) {
        if (error instanceof ExcelImportParseError && process.env.NODE_ENV === "development") {
            console.debug("Excel import parsers failed", {
                primary: error.cause instanceof Error ? error.cause.name : "unknown",
                fallback: error.fallbackCause instanceof Error ? error.fallbackCause.name : "not attempted",
            })
        }
        const resource = error.params?.resource
        const params = resource
            ? { ...error.params, resource: req.t(`resources.${resource}`, { defaultValue: resource }) }
            : error.params
        res.status(error.statusCode).json({ message: req.t(error.key, params),
            ...(error.key.startsWith("errors.generic_packaging_") ? { code: error.key.slice(7), groupId: error.params?.groupId, groupName: error.params?.group } : {}) })
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
            details: error.errors.map(() => req.t("errors.unique_constraint"))
        })
        return
    }

    if (error instanceof DatabaseError) {
        if (process.env.NODE_ENV === "development") {
            const driver = error.parent as Error & { code?: string; table?: string; column?: string }
            // Never log driver messages, SQL, values, URLs, detail or stack traces.
            console.error("Local database request failed", {
                code: /^[0-9A-Z]{5}$/.test(driver.code ?? "") ? driver.code : "unknown",
                table: /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(driver.table ?? "") ? driver.table : undefined,
                column: /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(driver.column ?? "") ? driver.column : undefined,
            })
        }
        const constraint = (error.parent as Error & { constraint?: string }).constraint
        const keys: Record<string, string> = {
            generic_packaging_assignment: "errors.generic_packaging_selection",
            packaging_associations_protected: "errors.packaging_associations_protected",
            packaging_generic_not_available: "errors.packaging_generic_not_available",
            packaging_role_mismatch: "errors.packaging_role_mismatch",
        }
        if (constraint && keys[constraint]) {
            res.status(422).json({ message: req.t(keys[constraint]) })
            return
        }
    }

    if (error instanceof SequelizeValidationError) {
        res.status(400).json({
            message: req.t("errors.validation"),
            details: error.errors.map(() => req.t("errors.validation"))
        })
        return
    }

    console.error("Unhandled request failure; sensitive details suppressed")
    res.status(500).json({ message: req.t("errors.internal") })
}
