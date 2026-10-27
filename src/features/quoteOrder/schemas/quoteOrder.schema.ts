import z from "zod"

export const quoteOrderSchema = z.strictObject({
    id: z.string().uuid(),
    clientName: z.string().trim().min(1).max(150),
    clientId: z.number().int().positive().nullable().optional(),
})
export type QuoteOrderIdentity = z.infer<typeof quoteOrderSchema>
