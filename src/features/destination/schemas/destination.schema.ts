import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"


export const destinationCountryEnum = z.enum(["GT", "US"])

export const createDestinationSchema = z.object({
    displayName: z.string().trim().min(1).max(120),
    baseCost: z.number().nonnegative(),
    country: destinationCountryEnum,
})

export const destinationIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const updateDestinationSchema = createDestinationSchema.partial()

export const destinationQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
    country: destinationCountryEnum.optional(),
})

export type CreateDestinationInput = z.infer<typeof createDestinationSchema>
export type UpdateDestinationInput = z.infer<typeof updateDestinationSchema>
export type DestinationQuery = z.infer<typeof destinationQuerySchema>
