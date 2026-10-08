import { Request, Response, NextFunction } from "express"
import { packagingGroupService } from "../services/packagingGroup.service"

function action(operation: (req: Request) => Promise<unknown>, status = 200) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try { res.status(status).json({ message: req.t(status === 201 ? "success.created" : "success.updated", { resource: req.t("resources.PackagingGroup") }), data: await operation(req) }) }
        catch (error) { next(error) }
    }
}
export const packagingGroupController = {
    list: action(() => packagingGroupService.list()),
    get: action(req => packagingGroupService.get(Number(req.params.id))),
    create: action(req => packagingGroupService.create(req.body.displayName), 201),
    update: action(req => packagingGroupService.update(Number(req.params.id), req.body.displayName)),
    status: action(req => packagingGroupService.status(Number(req.params.id), req.body.isActive)),
}
