import { Request, Response, NextFunction } from "express"
import { palletKitService } from "../services/palletKit.service"

function action(operation: (req: Request) => Promise<unknown>, message?: string) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try { res.json({ ...(message ? { message: req.t(message) } : {}), data: await operation(req) }) }
        catch (error) { next(error) }
    }
}
export const palletKitController = {
    get: action(() => palletKitService.getKit()),
    candidates: action(() => palletKitService.listCandidates()),
    add: action(req => palletKitService.addMaterial(req.body.packagingId), "success.pallet_kit_updated"),
    remove: action(req => palletKitService.removeMaterial(Number(req.params.packagingId)), "success.pallet_kit_updated"),
}
