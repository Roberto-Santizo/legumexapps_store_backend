import z from "zod"

export const palletKitMaterialSchema = z.strictObject({
    packagingId: z.number().int().positive(),
})
export const palletKitPackagingIdParamSchema = z.object({
    packagingId: z.string().regex(/^\d+$/),
})
