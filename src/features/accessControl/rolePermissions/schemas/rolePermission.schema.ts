import z from "zod"

export const roleIdParamSchema = z.object({
    roleId: z.string().regex(/^\d+$/),
})

export const syncRolePermissionsSchema = z.object({
    permissionIds: z.array(z.number().int().positive()),
})
