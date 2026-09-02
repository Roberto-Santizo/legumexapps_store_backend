import {unitService} from '../services/unit.service'
import { Request, Response, NextFunction } from "express";
import { UnitQuery } from "../schemas/unit.schema";


async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const { page, limit, search } = req.query as unknown as UnitQuery
        const result = await unitService.listUnits({ page, limit }, search)
        res.json(result)
    }catch(error){
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const unitId = Number(req.params.id)
        const unit = await unitService.getUnitById(unitId)
        res.json({data: unit})
    }catch(error){
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const unit = await unitService.createUnit(req.body)
        res.status(201).json({
            // req.t = i18next translation function, see src/config/i18n.ts
            message: req.t("success.created", {resource: req.t("resources.Unit")}),
            data: unit
        })
    }catch(error){
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try{
        const unitId = Number(req.params.id)
        const unit = await unitService.updateUnit(unitId, req.body)
        res.json({
            message: req.t("success.updated", {resource: req.t("resources.Unit")}),
            data: unit
        })
    }catch(error){
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void>{
    try{
        const unitId = Number(req.params.id)
        await unitService.deleteUnit(unitId)
        res.json({message: req.t("success.deleted", {resource: req.t("resources.Unit")})})
    }catch(error){
        next(error)
    }
}

export const unitController = {
    index,
    show,
    store,
    update,
    destroy
}