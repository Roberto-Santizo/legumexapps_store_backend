import { permissionService } from "../services/permission.service";
import  {Request, Response, NextFunction} from "express"
import { toPermissionResponse } from "../utils/localizePermissionName"

async function index(req:Request, res:Response, next:NextFunction): Promise<void> {
    try {
        const permissions = await permissionService.listPermission()
        res.json({data: permissions.map(permission => toPermissionResponse(req, permission))})
    } catch (error) {
        next(error)
    }
}

async function show(req:Request,res:Response,next:NextFunction): Promise<void> {
    try {
        const permissionId= Number(req.params.id)
        const permission = await permissionService.getPermissionById(permissionId)
        res.json({data: toPermissionResponse(req, permission)})
    } catch (error) {
        next(error)
    }
}
async function store(req:Request,res:Response,next:NextFunction): Promise<void> {
    try {
        const permission = await permissionService.createPermission(req.body)
        res.status(201).json({
            message:req.t("success.created",{resource:req.t("resources.Permission")}),
            data: toPermissionResponse(req, permission)
        })
    } catch (error) {
        next(error)
    }
}
async function update(req:Request, res:Response, next:NextFunction):Promise<void> {
    try {
        const permissionId = Number(req.params.id)
        const permission = await permissionService.updatePermission(permissionId,req.body)
        res.json({
            message: req.t("success.updated",{resource:req.t("resources.Permission")}),
            data: toPermissionResponse(req, permission)
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req:Request, res:Response, next:NextFunction): Promise<void> {
    try {
       const permissionId = Number(req.params.id)
       await permissionService.deletePermission(permissionId)
       res.json({message: req.t("success.deleted",{resource:req.t("resources.Permission")})}) 
    } catch (error) {
        next(error)
    }
}

export const permissionController = {
    index,
    show,
    store,
    update,
    destroy
}