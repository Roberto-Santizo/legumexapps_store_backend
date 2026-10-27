import bcrypt from "bcryptjs"
import type { Transaction } from "sequelize"
import Permission from "../../features/accessControl/permissions/models/Permission.model"
import Role from "../../features/accessControl/roles/models/Role.model"
import RolePermission from "../../features/accessControl/rolePermissions/models/RolePermission.model"
import User from "../../features/accessControl/user/models/User.model"
import { PERMISSIONS, ADMIN_ROLE_NAME } from "../../features/accessControl/permissions/constants/accessControlPolicy"
import { validateBootstrapCredentials } from "../bootstrap"

export async function seedAccessControl(transaction: Transaction, credentials: {username?:string;password?:string}): Promise<void> {
    await Permission.bulkCreate(PERMISSIONS.map(item=>({name:item.name,isActive:true})),{ignoreDuplicates:true,transaction})
    const [role]=await Role.findOrCreate({where:{name:ADMIN_ROLE_NAME},defaults:{isActive:true},transaction})
    const permissions=await Permission.findAll({where:{name:PERMISSIONS.map(item=>item.name)},attributes:['id'],transaction})
    await RolePermission.bulkCreate(permissions.map(permission=>({role_id:role.id,permission_id:permission.id})),{ignoreDuplicates:true,transaction})
    if(await User.count({transaction})!==0) return
    if(!credentials.username && !credentials.password) {
        console.warn('[DB] Sin usuarios: configurá SEED_ADMIN_USERNAME y SEED_ADMIN_PASSWORD para crear el administrador inicial.')
        return
    }
    const initial={username:credentials.username!,password:credentials.password!}
    validateBootstrapCredentials(initial)
    await User.create({name:initial.username,username:initial.username,password:await bcrypt.hash(initial.password,12),role_id:role.id,isActive:true,failed_attempts:0},{transaction})
}
