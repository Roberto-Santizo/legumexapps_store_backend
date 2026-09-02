import { Request, Response, NextFunction } from "express"
import { productVariantService } from "../services/productVariant.service"

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

export const productVariantController = {
    index,
    show,
    store,
    update,
    destroy,
}
