import { NotFoundError } from "../../../../shared/errors/AppError";
import { CreatePermissionInput,UpdatePermissionInput } from "../schemas/permission.schema";
import Permission from "../models/permission.model"

async function listPermission():Promise<Permission[]> {
    return Permission.findAll({where:{isActive:true}, order:[["name","DESC"]]})
}
async function getPermissionById(id:number):Promise<Permission> {
    const permission = await Permission.findOne({where:{id,isActive: true}})
    if(!permission) {
        throw new NotFoundError("Permission",id)
    }
    return permission
}
async function createPermission(input:CreatePermissionInput): Promise<Permission> {
    return Permission.create(input)
}

async function updatePermission(id:number,input:UpdatePermissionInput):Promise<Permission> {
    const permission = await getPermissionById(id)
    return permission.update(input)
}
async function deletePermission(id:number):Promise<void> {
    const permission = await getPermissionById(id)
    await permission.update({isActive:false})
}

export const permissionService = {
    listPermission,
    getPermissionById,
    createPermission,
    updatePermission,
    deletePermission
}