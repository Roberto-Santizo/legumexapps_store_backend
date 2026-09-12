import { Request, Response, NextFunction } from "express"
import { productVariantUnitMaterialService } from "../services/productVariantUnitMaterial.service"

async function index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantUnitMaterials = await productVariantUnitMaterialService.listProductVariantUnitMaterials()
        res.json({ data: productVariantUnitMaterials })
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantUnitMaterialId = Number(req.params.id)
        const productVariantUnitMaterial = await productVariantUnitMaterialService.getProductVariantUnitMaterialById(
            productVariantUnitMaterialId
        )
        res.json({ data: productVariantUnitMaterial })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantUnitMaterial = await productVariantUnitMaterialService.createProductVariantUnitMaterial(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.ProductVariantUnitMaterial") }),
            data: productVariantUnitMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantUnitMaterialId = Number(req.params.id)
        const productVariantUnitMaterial = await productVariantUnitMaterialService.updateProductVariantUnitMaterial(
            productVariantUnitMaterialId,
            req.body
        )
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.ProductVariantUnitMaterial") }),
            data: productVariantUnitMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantUnitMaterialId = Number(req.params.id)
        await productVariantUnitMaterialService.deleteProductVariantUnitMaterial(productVariantUnitMaterialId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.ProductVariantUnitMaterial") }) })
    } catch (error) {
        next(error)
    }
}

export const productVariantUnitMaterialController = {
    index,
    show,
    store,
    update,
    destroy,
}
