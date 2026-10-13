import type { Request, Response, NextFunction } from "express"
import { representativeClientService } from "../services/representativeClient.service"

function handle(action: "list" | "assign" | "remove") {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = Number(req.params.id)
            const data = action === "list" ? await representativeClientService.list(id)
                : action === "assign" ? await representativeClientService.assign(id, req.body.clientIds)
                    : await representativeClientService.remove(id, Number(req.params.clientId))
            res.json({ data, ...(action === "list" ? {} : { message: req.t("success.representative_clients_updated") }) })
        } catch (error) { next(error) }
    }
}

export const representativeClientController = { list: handle("list"), assign: handle("assign"), remove: handle("remove") }
