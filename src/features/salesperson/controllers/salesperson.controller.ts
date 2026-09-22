import { Request, Response, NextFunction } from "express"
import { salespersonService } from "../services/salesperson.service"
import { SalespersonQuery } from "../schemas/salesperson.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as SalespersonQuery
        const result = await salespersonService.listSalespeople({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const salespersonId = Number(req.params.id)
        const salesperson = await salespersonService.getSalespersonById(salespersonId)
        res.json({ data: salesperson })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const salesperson = await salespersonService.createSalesperson(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.Salesperson") }),
            data: salesperson
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const salespersonId = Number(req.params.id)
        const salesperson = await salespersonService.updateSalesperson(salespersonId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Salesperson") }),
            data: salesperson
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const salespersonId = Number(req.params.id)
        await salespersonService.deleteSalesperson(salespersonId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.Salesperson") }) })
    } catch (error) {
        next(error)
    }
}

async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const salespersonId = Number(req.params.id)
        const { isActive } = req.body
        const salesperson = await salespersonService.setSalespersonStatus(salespersonId, isActive)
        res.json({
            message: req.t(isActive ? "success.activated" : "success.deactivated", { resource: req.t("resources.Salesperson") }),
            data: salesperson
        })
    } catch (error) {
        next(error)
    }
}

export const salespersonController = {
    index,
    show,
    store,
    update,
    destroy,
    updateStatus,
}
