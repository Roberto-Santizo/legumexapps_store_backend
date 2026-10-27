import { Request, RequestHandler } from "express"
import {
    juiceService, juiceRawMaterialService, juicePresentationService,
    juiceMixService, juiceSpiceMaterialService, juiceSpiceService,
} from "../services/juiceCatalog.service"
import { linkJuiceProduct } from "../services/juiceProductLink.service"
import { createLinkedJuice } from "../services/juiceProductCreate.service"

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

// Juice + commercial product: create both together, or link an existing juice to a new product.
export const juiceProductController = {
    createWithProduct: handler(req => createLinkedJuice(req.body), "Juice", "created", 201),
    linkProduct: handler(req => linkJuiceProduct(Number(req.params.id), req.body.subCategoryId), "Product", "created", 201),
}
