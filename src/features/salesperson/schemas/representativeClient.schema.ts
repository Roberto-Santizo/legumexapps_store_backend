import z from "zod"

const databaseId = z.number().int().positive().max(2147483647)
const paramId = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(databaseId)

export const representativeClientParamsSchema = z.object({ id: paramId })
export const representativeClientRemoveParamsSchema = representativeClientParamsSchema.extend({ clientId: paramId })
export const assignRepresentativeClientsSchema = z.strictObject({
    clientIds: z.array(databaseId).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
})
