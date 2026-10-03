import { Request, RequestHandler } from "express"
import {
    juiceService, juiceRawMaterialService, juicePresentationService,
    juiceMixService, juiceSpiceMaterialService, juiceSpiceService,
} from "../services/juiceCatalog.service"
import { juiceConfigService } from "../services/juiceConfig.service"

type Operation = (req: Request) => Promise<unknown>
function handler(operation: Operation, resource: string, action?: "created" | "updated" | "status", status = 200): RequestHandler {
    return async (req, res, next) => {
        try {
            const data = await operation(req)
            const success = action === "status"
                ? req.method === "DELETE" || !req.body.isActive ? "deactivated" : "activated"
                : action
            res.status(status).json({
                ...(success ? { message: req.t(`success.${success}`, { resource: req.t(`resources.${resource}`) }) } : {}),
                data,
            })
        } catch (error) { next(error) }
    }
}

function catalogController(service: typeof juiceService, resource: string) {
    return {
        list: handler(req => service.list(req.query.juiceId === undefined ? undefined : Number(req.query.juiceId)), resource),
        get: handler(req => service.get(Number(req.params.id)), resource),
        create: handler(req => service.create(req.body), resource, "created", 201),
        update: handler(req => service.update(Number(req.params.id), req.body), resource, "updated"),
        status: handler(req => service.setStatus(Number(req.params.id), req.body.isActive), resource, "status"),
        remove: handler(req => service.setStatus(Number(req.params.id), false), resource, "status"),
    }
}

export const juiceControllers = {
    juices: catalogController(juiceService, "Juice"),
    rawMaterials: catalogController(juiceRawMaterialService, "JuiceRawMaterial"),
    presentations: catalogController(juicePresentationService, "JuicePresentation"),
    mix: catalogController(juiceMixService, "JuiceMix"),
    spiceMaterials: catalogController(juiceSpiceMaterialService, "JuiceSpiceMaterial"),
    spices: catalogController(juiceSpiceService, "JuiceSpice"),
}

export const juiceConfigController = {
    get: handler(() => juiceConfigService.getGlobal(), "JuiceCostConstants"),
    create: handler(req => juiceConfigService.createGlobal(req.body), "JuiceCostConstants", "created", 201),
    update: handler(req => juiceConfigService.updateGlobal(req.body), "JuiceCostConstants", "updated"),
    listOverrides: handler(() => juiceConfigService.listOverrides(), "JuiceClientConstantOverride"),
    getOverride: handler(req => juiceConfigService.getOverride(Number(req.params.clientId)), "JuiceClientConstantOverride"),
    createOverride: handler(req => juiceConfigService.createOverride(req.body), "JuiceClientConstantOverride", "created", 201),
    updateOverride: handler(req => juiceConfigService.updateOverride(Number(req.params.clientId), req.body), "JuiceClientConstantOverride", "updated"),
    overrideStatus: handler(req => juiceConfigService.setOverrideStatus(Number(req.params.clientId), req.body.isActive), "JuiceClientConstantOverride", "status"),
    removeOverride: handler(req => juiceConfigService.setOverrideStatus(Number(req.params.clientId), false), "JuiceClientConstantOverride", "status"),
    resolve: handler(req => juiceConfigService.resolveConstants(Number(req.params.clientId)), "JuiceCostConstants"),
}
