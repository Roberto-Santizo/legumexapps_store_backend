import z from "zod"

export const createPermissionSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(200).optional()
})

export const permissionIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updatePermissionSchema = createPermissionSchema.partial()

export type CreatePermissionInput = z.infer<typeof createPermissionSchema>
export type UpdatePermissionInput = z.infer<typeof updatePermissionSchema>
