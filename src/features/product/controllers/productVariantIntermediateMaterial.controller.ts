import { Request, Response, NextFunction } from "express"
import { productVariantIntermediateMaterialService } from "../services/productVariantIntermediateMaterial.service"

async function index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantIntermediateMaterials = await productVariantIntermediateMaterialService.listProductVariantIntermediateMaterials()
        res.json({ data: productVariantIntermediateMaterials })
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantIntermediateMaterialId = Number(req.params.id)
        const productVariantIntermediateMaterial = await productVariantIntermediateMaterialService.getProductVariantIntermediateMaterialById(
            productVariantIntermediateMaterialId
        )
        res.json({ data: productVariantIntermediateMaterial })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantIntermediateMaterial = await productVariantIntermediateMaterialService.createProductVariantIntermediateMaterial(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.ProductVariantIntermediateMaterial") }),
            data: productVariantIntermediateMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantIntermediateMaterialId = Number(req.params.id)
        const productVariantIntermediateMaterial = await productVariantIntermediateMaterialService.updateProductVariantIntermediateMaterial(
            productVariantIntermediateMaterialId,
            req.body
        )
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.ProductVariantIntermediateMaterial") }),
            data: productVariantIntermediateMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantIntermediateMaterialId = Number(req.params.id)
        await productVariantIntermediateMaterialService.deleteProductVariantIntermediateMaterial(productVariantIntermediateMaterialId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.ProductVariantIntermediateMaterial") }) })
    } catch (error) {
        next(error)
    }
}

export const productVariantIntermediateMaterialController = {
    index,
    show,
    store,
    update,
    destroy,
}
