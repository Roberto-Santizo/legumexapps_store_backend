import z from "zod"

export const palletKitRulesSchema = z.strictObject({
    defaultPackagingId: z.number().int().positive(),
    overrides: z.array(z.strictObject({ clientId: z.number().int().positive(), packagingId: z.number().int().positive() })).max(1000),
}).refine(value => new Set(value.overrides.map(row => row.clientId)).size === value.overrides.length && value.overrides.every(row => row.packagingId !== value.defaultPackagingId))

export const palletKitMaterialSchema = z.strictObject({
    packagingId: z.number().int().positive(),
})
export const palletKitPackagingIdParamSchema = z.object({
    packagingId: z.string().regex(/^\d+$/),
})
