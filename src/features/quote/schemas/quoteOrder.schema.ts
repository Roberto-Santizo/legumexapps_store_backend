import z from "zod"

export const quoteOrderSchema = z.strictObject({
    id: z.string().uuid(),
    clientName: z.string().trim().min(1).max(150),
})
export type QuoteOrderIdentity = z.infer<typeof quoteOrderSchema>
