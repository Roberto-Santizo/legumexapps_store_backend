import { Request, Response, NextFunction } from "express"
import { productIngredientService } from "../services/productIngredient.service"

async function index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredients = await productIngredientService.listProductIngredients()
        res.json({ data: productIngredients })
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredientId = Number(req.params.id)
        const productIngredient = await productIngredientService.getProductIngredientById(productIngredientId)
        res.json({ data: productIngredient })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredient = await productIngredientService.createProductIngredient(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.ProductIngredient") }),
            data: productIngredient
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredientId = Number(req.params.id)
        const productIngredient = await productIngredientService.updateProductIngredient(productIngredientId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.ProductIngredient") }),
            data: productIngredient
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productIngredientId = Number(req.params.id)
        await productIngredientService.deleteProductIngredient(productIngredientId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.ProductIngredient") }) })
    } catch (error) {
        next(error)
    }
}

export const productIngredientController = {
    index,
    show,
    store,
    update,
    destroy,
}
