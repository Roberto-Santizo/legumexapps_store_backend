import { Request, Response, NextFunction } from "express"
import { productVariantPalletMaterialService } from "../services/productVariantPalletMaterial.service"

async function index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantPalletMaterials = await productVariantPalletMaterialService.listProductVariantPalletMaterials()
        res.json({ data: productVariantPalletMaterials })
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantPalletMaterialId = Number(req.params.id)
        const productVariantPalletMaterial = await productVariantPalletMaterialService.getProductVariantPalletMaterialById(
            productVariantPalletMaterialId
        )
        res.json({ data: productVariantPalletMaterial })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantPalletMaterial = await productVariantPalletMaterialService.createProductVariantPalletMaterial(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.ProductVariantPalletMaterial") }),
            data: productVariantPalletMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantPalletMaterialId = Number(req.params.id)
        const productVariantPalletMaterial = await productVariantPalletMaterialService.updateProductVariantPalletMaterial(
            productVariantPalletMaterialId,
            req.body
        )
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.ProductVariantPalletMaterial") }),
            data: productVariantPalletMaterial
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productVariantPalletMaterialId = Number(req.params.id)
        await productVariantPalletMaterialService.deleteProductVariantPalletMaterial(productVariantPalletMaterialId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.ProductVariantPalletMaterial") }) })
    } catch (error) {
        next(error)
    }
}

export const productVariantPalletMaterialController = {
    index,
    show,
    store,
    update,
    destroy,
}
