import type { Request, Response, NextFunction } from "express"
import { laborTemplateService as service } from "../services/laborTemplate.service"

function read(operation: (req: Request) => unknown) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try { res.json({ data: await operation(req) }) }
        catch (error) { next(error) }
    }
}

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        res.json(await service.list({ page: Number(req.query.page) || undefined, limit: Number(req.query.limit) || undefined }, req.query.search as string | undefined))
    } catch (error) { next(error) }
}

async function save(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const id = req.params.id ? Number(req.params.id) : undefined
        const result = await service.save(id, req.body, req.user!.id)
        res.status(id ? 200 : 201).json({ message: req.t("success.labor_template_saved"), data: result })
    } catch (error) { next(error) }
}

async function saveLine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json({ message: req.t("success.labor_line_saved"), data: await service.saveLine(String(req.params.code), req.body) }) }
    catch (error) { next(error) }
}

export const laborTemplateController = {
    index, save, saveLine,
    reference: read(() => service.reference()),
    lines: read(() => service.listLines()),
    preview: read(req => service.preview(req.body)),
    show: read(req => service.get(Number(req.params.id))),
    revisions: read(req => service.revisions(Number(req.params.id))),
    revision: read(req => service.get(Number(req.params.id), Number(req.params.revision))),
}
