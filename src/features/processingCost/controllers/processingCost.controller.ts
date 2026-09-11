import { Request, Response, NextFunction } from "express"
import { processingCostService } from "../services/processingCost.service"
import { ProcessingCostQuery } from "../schemas/processingCost.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as ProcessingCostQuery
        const result = await processingCostService.listProcessingCosts({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const processingCostId = Number(req.params.id)
        const processingCost = await processingCostService.getProcessingCostById(processingCostId)
        res.json({ data: processingCost })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const processingCost = await processingCostService.createProcessingCost(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.ProcessingCost") }),
            data: processingCost
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const processingCostId = Number(req.params.id)
        const processingCost = await processingCostService.updateProcessingCost(processingCostId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.ProcessingCost") }),
            data: processingCost
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const processingCostId = Number(req.params.id)
        await processingCostService.deleteProcessingCost(processingCostId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.ProcessingCost") }) })
    } catch (error) {
        next(error)
    }
}

export const processingCostController = {
    index,
    show,
    store,
    update,
    destroy,
}
