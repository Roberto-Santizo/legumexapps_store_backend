import { Request, Response, NextFunction } from "express";
import { rolePermissionService } from "../services/rolePermission.service";
import { toPermissionResponse } from "../../permissions/utils/localizePermissionName";

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const roleId = Number(req.params.roleId)
        const permissions = await rolePermissionService.getPermissionsByRole(roleId)
        res.json({ data: permissions.map(permission => toPermissionResponse(req, permission)) })
    } catch (error) {
        next(error)
    }
}

async function sync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const roleId = Number(req.params.roleId)
        const permissions = await rolePermissionService.syncRolePermissions(roleId, req.body.permissionIds)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Role") }),
            data: permissions.map(permission => toPermissionResponse(req, permission))
        })
    } catch (error) {
        next(error)
    }
}

export const rolePermissionController = {
    index,
    sync
}
