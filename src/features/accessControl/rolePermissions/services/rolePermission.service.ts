import sequelize from "../../../../database/connection";
import { NotFoundError } from "../../../../shared/errors/AppError";
import Permission from "../../permissions/models/permission.model";
import { roleService } from "../../roles/services/role.service";
import RolePermission from "../models/rolePermission.model";

async function getPermissionsByRole(roleId: number): Promise<Permission[]> {
    await roleService.getRoleById(roleId)
    return Permission.findAll({
        where: { isActive: true },
        include: [{
            association: "roles",
            attributes: [],
            where: { id: roleId },
            required: true
        }],
        order: [["name", "DESC"]]
    })
}

async function syncRolePermissions(roleId: number, permissionIds: number[]): Promise<Permission[]> {
    await roleService.getRoleById(roleId)

    const uniqueIds = [...new Set(permissionIds)]
    if (uniqueIds.length > 0) {
        const validCount = await Permission.count({ where: { id: uniqueIds, isActive: true } })
        if (validCount !== uniqueIds.length) throw new NotFoundError("Permission", uniqueIds.join(","))
    }

    await sequelize.transaction(async (transaction) => {
        await RolePermission.destroy({ where: { role_id: roleId }, transaction })
        if (uniqueIds.length > 0) {
            await RolePermission.bulkCreate(
                uniqueIds.map(permissionId => ({ role_id: roleId, permission_id: permissionId })),
                { transaction }
            )
        }
    })

    return getPermissionsByRole(roleId)
}

export const rolePermissionService = {
    getPermissionsByRole,
    syncRolePermissions
}
