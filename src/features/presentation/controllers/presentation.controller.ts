import { Request, Response, NextFunction } from "express"
import { presentationService } from "../services/presentation.service"
import { PresentationQuery } from "../schemas/presentation.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as PresentationQuery
        const result = await presentationService.listPresentations({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const presentationId = Number(req.params.id)
        const presentation = await presentationService.getPresentationById(presentationId)
        res.json({ data: presentation })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const presentation = await presentationService.createPresentation(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.Presentation") }),
            data: presentation
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const presentationId = Number(req.params.id)
        const presentation = await presentationService.updatePresentation(presentationId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Presentation") }),
            data: presentation
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const presentationId = Number(req.params.id)
        await presentationService.deletePresentation(presentationId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.Presentation") }) })
    } catch (error) {
        next(error)
    }
}

export const presentationController = {
    index,
    show,
    store,
    update,
    destroy,
}
