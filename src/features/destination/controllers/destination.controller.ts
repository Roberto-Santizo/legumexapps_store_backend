import { Request, Response, NextFunction } from "express"
import { destinationService } from "../services/destination.service"
import { DestinationQuery } from "../schemas/destination.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search, country } = req.query as unknown as DestinationQuery
        const result = await destinationService.listDestinations({ page, limit }, search, country)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const destinationId = Number(req.params.id)
        const destination = await destinationService.getDestinationById(destinationId)
        res.json({ data: destination })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const destination = await destinationService.createDestination(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.Destination") }),
            data: destination
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const destinationId = Number(req.params.id)
        const destination = await destinationService.updateDestination(destinationId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Destination") }),
            data: destination
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const destinationId = Number(req.params.id)
        await destinationService.deleteDestination(destinationId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.Destination") }) })
    } catch (error) {
        next(error)
    }
}

export const destinationController = {
    index,
    show,
    store,
    update,
    destroy,
}
