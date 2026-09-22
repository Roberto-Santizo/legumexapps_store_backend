import z from "zod"

export const salespersonLoginSchema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1),
})

export type SalespersonLoginInput = z.infer<typeof salespersonLoginSchema>
