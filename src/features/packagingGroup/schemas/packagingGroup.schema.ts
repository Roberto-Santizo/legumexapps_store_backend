import { z } from "zod"
export const packagingGroupSchema = z.object({ displayName: z.string().trim().min(1).max(60) })
export const packagingGroupStatusSchema = z.object({ isActive: z.boolean() })
export const packagingGroupIdSchema = z.object({ id: z.string().regex(/^\d+$/) })
