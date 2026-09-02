import { Request, Response, NextFunction } from "express"
import { categoryService } from "../services/category.service"
import { CategoryQuery } from "../schemas/category.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as CategoryQuery
        const result = await categoryService.listCategories({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const  categoryId = Number(req.params.id)
        const category = await categoryService.getCategoryById(categoryId)
        res.json({ data: category })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const category = await categoryService.createCategory(req.body)
        res.status(201).json({
            // req.t = i18next translation function, see src/config/i18n.ts
            message: req.t("success.created", { resource: req.t("resources.Category") }),
            data: category
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const categoryId = Number(req.params.id)
        const category = await categoryService.updateCategory(categoryId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Category") }),
            data: category
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = Number(req.params.id)
        await categoryService.deleteCategory(id)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.Category") }) })
    } catch (error) {
        next(error)
    }
}

async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = Number(req.params.id)
        const { isActive } = req.body
        const category = await categoryService.setCategoryStatus(id, isActive)
        res.json({
            message: req.t(isActive ? "success.activated" : "success.deactivated", { resource: req.t("resources.Category") }),
            data: category
        })
    } catch (error) {
        next(error)
    }
}

export const categoryController = {
    index,
    show,
    store,
    update,
    destroy,
    updateStatus,
}