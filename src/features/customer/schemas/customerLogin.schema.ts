import z from "zod"

export const customerLoginSchema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1),
})

export type CustomerLoginInput = z.infer<typeof customerLoginSchema>
