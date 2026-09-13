import { Request, Response, NextFunction } from "express"
import { leadService } from "../services/lead.service"
import { LeadQuery, PublicCreateLeadInput, UpdateLeadInput } from "../schemas/lead.schema"

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { website, ...rest } = req.body as PublicCreateLeadInput

        // Honeypot: un bot completa este campo oculto, un humano nunca lo ve (ver
        // lead.schema.ts). Respondemos éxito igual para no delatar la trampa, pero sin tocar
        // la base de datos.
        if (!website) {
            await leadService.createLead(rest)
        }

        res.status(201).json({ message: req.t("success.created", { resource: req.t("resources.Lead") }) })
    } catch (error) {
        next(error)
    }
}

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search, status } = req.query as unknown as LeadQuery
        const result = await leadService.listLeads({ page, limit }, search, status)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const leadId = Number(req.params.id)
        const lead = await leadService.getLeadById(leadId)
        res.json({ data: lead })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const leadId = Number(req.params.id)
        const lead = await leadService.updateLead(leadId, req.body as UpdateLeadInput)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Lead") }),
            data: lead,
        })
    } catch (error) {
        next(error)
    }
}

export const leadController = {
    store,
    index,
    show,
    update,
}
