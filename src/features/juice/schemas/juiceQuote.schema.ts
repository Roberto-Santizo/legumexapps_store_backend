import { z } from "zod"

// Quantity is cases (not bottles or pallets); transport allocation always uses a full container.
export const calculateJuiceQuoteSchema = z.strictObject({
    juiceId: z.number().int().positive().max(2147483647),
    presentationId: z.number().int().positive().max(2147483647),
    quantity: z.number().int().positive().max(2147483647),
})
