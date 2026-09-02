import { Request, Response, NextFunction } from "express"
import { subCategoryService } from "../services/subCategory.service"
import { SubCategoryQuery } from "../schemas/subCategory.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as SubCategoryQuery
        const result = await subCategoryService.listSubCategories({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = Number(req.params.id)
        const subCategory = await subCategoryService.getSubCategoryById(id)
        res.json({ data: subCategory })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const subCategory = await subCategoryService.createSubCategory(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.SubCategory") }),
            data: subCategory
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = Number(req.params.id)
        const subCategory = await subCategoryService.updateSubCategory(id, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.SubCategory") }),
            data: subCategory
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = Number(req.params.id)
        await subCategoryService.deleteSubCategory(id)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.SubCategory") }) })
    } catch (error) {
        next(error)
    }
}

async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = Number(req.params.id)
        const { isActive } = req.body
        const subCategory = await subCategoryService.setSubCategoryStatus(id, isActive)
        res.json({
            message: req.t(isActive ? "success.activated" : "success.deactivated", { resource: req.t("resources.SubCategory") }),
            data: subCategory
        })
    } catch (error) {
        next(error)
    }
}

export const subCategoryController = {
    index,
    show,
    store,
    update,
    destroy,
    updateStatus,
}
