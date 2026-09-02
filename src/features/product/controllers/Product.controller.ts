import {Request, Response, NextFunction} from "express"
import {productService} from "../services/product.service"
import { ProductQuery } from "../schemas/product.schema"


async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const { page, limit, search } = req.query as unknown as ProductQuery
        const result = await productService.listProducts({ page, limit }, search)
        res.json(result)
    }catch(error){
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const productId = Number(req.params.id)
        const product = await productService.getProductById(productId)
        res.json({data: product})
    }catch(error){
        next(error)
    }
}

async function store(req:Request, res:Response, next: NextFunction): Promise<void> {
    try{
        const product = await productService.createProduct(req.body)
        res.status(201).json({
            // req.t = i18next translation function, see src/config/i18n.ts
            message: req.t("success.created", {resource: req.t("resources.Product")}),
            data: product
        })
    }catch(error){
        next(error)
    }
}

async function update(req:Request, res:Response, next:NextFunction): Promise<void>{
    try{
        const productId = Number(req.params.id)
        const product = await productService.updateProduct(productId, req.body)
        res.json({
            message: req.t("success.updated", {resource: req.t("resources.Product")}),
            data: product
        })

    }catch(error){
        next(error)
    }
}

async function destroy(req:Request, res:Response, next:NextFunction): Promise<void>{
    try{
        const productId = Number(req.params.id)
        await productService.deleteProduct(productId)
        res.json({message: req.t("success.deleted", {resource: req.t("resources.Product")})})

    }catch(error){
        next(error)
    }
}

async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const productId = Number(req.params.id)
        const { isActive } = req.body
        const product = await productService.setProductStatus(productId, isActive)
        res.json({
            message: req.t(isActive ? "success.activated" : "success.deactivated", { resource: req.t("resources.Product") }),
            data: product
        })
    } catch (error) {
        next(error)
    }
}


export const productController = {
    index,
    show,
    store,
    update,
    destroy,
    updateStatus,
}