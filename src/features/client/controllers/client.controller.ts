import { Request, Response, NextFunction } from "express"
import { clientService } from "../services/client.service"
import { ClientQuery } from "../schemas/client.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as ClientQuery
        const result = await clientService.listClients({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const clientId = Number(req.params.id)
        const client = await clientService.getClientById(clientId)
        res.json({ data: client })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const client = await clientService.createClient(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.Client") }),
            data: client
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const clientId = Number(req.params.id)
        const client = await clientService.updateClient(clientId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Client") }),
            data: client
        })
    } catch (error) {
        next(error)
    }
}

async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const clientId = Number(req.params.id)
        const { isActive } = req.body
        const client = await clientService.setClientStatus(clientId, isActive)
        res.json({
            message: req.t(isActive ? "success.activated" : "success.deactivated", { resource: req.t("resources.Client") }),
            data: client
        })
    } catch (error) {
        next(error)
    }
}

export const clientController = {
    index,
    show,
    store,
    update,
    updateStatus,
}
