import { Request, Response, NextFunction } from "express"
import { ingredientService } from "../services/ingredient.service"
import { IngredientQuery } from "../schemas/ingredient.schema"
import { AppError } from "../../../shared/errors/AppError"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as IngredientQuery
        const result = await ingredientService.listIngredients({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const ingredientId = Number(req.params.id)
        const ingredient = await ingredientService.getIngredientById(ingredientId)
        res.json({ data: ingredient })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const ingredient = await ingredientService.createIngredient(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.Ingredient") }),
            data: ingredient
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const ingredientId = Number(req.params.id)
        const ingredient = await ingredientService.updateIngredient(ingredientId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Ingredient") }),
            data: ingredient
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const ingredientId = Number(req.params.id)
        await ingredientService.deleteIngredient(ingredientId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.Ingredient") }) })
    } catch (error) {
        next(error)
    }
}

// Mismo patrón que packagingController.bulkImport/downloadTemplate -- ver ese archivo para el
// razonamiento completo (por qué el tipo se valida acá y no con `fileFilter` de multer, etc.).
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
        const ingredients = await ingredientService.bulkImportIngredients(req.file.buffer)
        res.status(201).json({
            message: req.t("success.bulk_imported", { count: ingredients.length }),
            data: { created: ingredients.length }
        })
    } catch (error) {
        next(error)
    }
}

async function downloadTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await ingredientService.buildIngredientImportTemplate()
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", "attachment; filename=\"plantilla-ingredientes.xlsx\"")
        res.send(buffer)
    } catch (error) {
        next(error)
    }
}

export const ingredientController = {
    index,
    show,
    store,
    update,
    destroy,
    bulkImport,
    downloadTemplate,
}
