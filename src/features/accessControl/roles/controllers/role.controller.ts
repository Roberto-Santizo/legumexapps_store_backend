import {roleService} from "../services/role.service"
import { Request, Response, NextFunction } from "express"
import { RoleQuery } from "../schemas/role.schema"

async function index(req: Request, res:Response, next:NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as RoleQuery
        const result = await roleService.listRoles({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}
async function show(req:Request, res:Response, next:NextFunction):Promise<void> {
    try {
        const roleId = Number(req.params.id)
        const role = await roleService.getRoleById(roleId)
        res.json({data:role})
    } catch (error) {
        next(error)
    }
}

async function store(req:Request, res:Response, next:NextFunction): Promise<void> {
    try {
        const role = await roleService.createRole(req.body)
        res.status(201).json({
            message: req.t("success.created",{resource: req.t("resources.Role")}),
            data: role
        })
    } catch (error) {
        next(error)
    }
}
async function update(req:Request, res:Response, next:NextFunction): Promise<void> {
    try {
        const roleId= Number(req.params.id)
        const role = await roleService.updateRole(roleId, req.body)
        res.json({
            message: req.t("success.updated", {resource: req.t("resources.Role")}),
            data: role
        })
    } catch (error) {
        next(error)
    }
}
async function destroy(req:Request, res:Response, next:NextFunction): Promise<void> {
    try {
        const roleId = Number(req.params.id)
        await roleService.deleteRole(roleId)
        res.json({message: req.t("success.deleted",{resource: req.t("resources.Role")})})
        
    } catch (error) {
        next(error)
    }
}

export const roleController = {
    index,
    show,
    store,
    update,
    destroy
}