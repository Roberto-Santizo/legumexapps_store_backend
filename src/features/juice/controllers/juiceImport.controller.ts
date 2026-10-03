import { Request, Response, NextFunction } from "express"
import { AppError } from "../../../shared/errors/AppError"
import { bulkImportJuices, buildJuiceImportTemplate } from "../services/juiceImport.service"

export const juiceImportController = {
    async import(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.file) throw new AppError(422, "errors.bulk_import_missing_file")
            if (req.file.mimetype !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") throw new AppError(422, "errors.bulk_import_invalid_file_type")
            const result = await bulkImportJuices(req.file.buffer)
            const created = result.rawMaterials + result.spiceMaterials + result.juices + result.mixRows + result.spiceRows + result.presentations
            res.status(201).json({ message: req.t("success.bulk_imported", { count: created }), data: { created, ...result } })
        } catch (error) { next(error) }
    },
    async template(_req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const buffer = await buildJuiceImportTemplate()
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            res.setHeader("Content-Disposition", 'attachment; filename="plantilla-jugos-fijos.xlsx"')
            res.send(buffer)
        } catch (error) { next(error) }
    },
}
