import z from "zod";
import { paginationQuerySchema } from "../../../../shared/schemas/pagination.schema";

export const  createRoleSchema = z.object({
    name : z.string().trim(),

})

export const roleIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateRoleSchema = createRoleSchema.partial()

export const roleQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

export type CreateRoleInput = z.infer<typeof createRoleSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>
export type RoleQuery = z.infer<typeof roleQuerySchema>