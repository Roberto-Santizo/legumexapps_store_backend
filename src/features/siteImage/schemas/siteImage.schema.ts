import { z } from "zod"
import { SITE_IMAGE_SLOTS } from "../models/SiteImage.model"

export const siteImageSlotEnum = z.enum(SITE_IMAGE_SLOTS)

// Mismo contrato que category.schema.ts/product.schema.ts para "image": string base64 nueva,
// null para borrarla, undefined (no viene) para no tocarla. Ver catalogImage.util.ts.
const imageInputSchema = z.string().nullable().optional()

export const updateSiteImageSchema = z.object({
    image: imageInputSchema,
    altText: z.string().trim().max(150).nullable().optional(),
})

export const siteImageSlotParamSchema = z.object({
    slotKey: siteImageSlotEnum,
})

export type SiteImageSlot = z.infer<typeof siteImageSlotEnum>
export type UpdateSiteImageInput = z.infer<typeof updateSiteImageSchema>
