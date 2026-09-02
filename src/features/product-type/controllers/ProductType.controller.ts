import { Request, Response, NextFunction } from "express";
import {productTypeService} from "../services/productType.service";
import { ProductTypeQuery } from "../schemas/productType.schema";

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const { page, limit, search } = req.query as unknown as ProductTypeQuery
        const result = await productTypeService.listProductTypes({ page, limit }, search)
        res.json(result)
    }catch(error){
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const productTypeId = Number(req.params.id)
        const productType = await productTypeService.getProductTypeById(productTypeId)
        res.json({data: productType})
    }catch(error){
        next(error)
    }
}

async function store(req: Request, res:Response, next: NextFunction): Promise<void> {
    try{
        const productType = await productTypeService.createProductType(req.body)
        res.status(201).json({
            // req.t = i18next translation function, see src/config/i18n.ts
            message: req.t("success.created", {resource: req.t("resources.ProductType")}),
            data: productType
        })

    }catch(error){
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const productTypeId = Number(req.params.id)
        const productType = await productTypeService.updateProductType(productTypeId, req.body)
        res.json({
            message: req.t("success.updated", {resource: req.t("resources.ProductType")}),
            data: productType
        })
    }catch(error){
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const productTypeId = Number(req.params.id)
        await productTypeService.deleteProductType(productTypeId)
        res.json({message: req.t("success.deleted", {resource: req.t("resources.ProductType")})})
    }catch(error){
        next(error)
    }
}

export const productTypeController = {
    index,
    show,
    store,
    update,
    destroy
}