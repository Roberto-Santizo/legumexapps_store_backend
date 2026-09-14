import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

const packagingRoleEnum = z.enum(["unit", "intermediate", "pallet"])

export const createPackagingSchema = z.object({
    code: z.string().trim().min(1).max(60),
    displayName: z.string().trim().min(1).max(80),
    packagingRole: packagingRoleEnum,
    unitCost: z.number().nonnegative(),
})

export const packagingIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

// Mismo patrón que productVariantSkuCodeParamSchema (product/schemas/productVariant.schema.ts) --
// param de solo lectura para el filtro "Empaques de este SKU" del catálogo de Empaques.
export const packagingSkuCodeParamSchema = z.object({
    skuCode: z.string().trim().min(1).max(60),
})


export const updatePackagingSchema = createPackagingSchema.partial().extend({
    code: createPackagingSchema.shape.code,
    packagingRole: createPackagingSchema.shape.packagingRole,
    unitCost: createPackagingSchema.shape.unitCost,
})

export const packagingQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
})

// Forma de respuesta de GET /packagings/by-sku/:skuCode (filtro "Empaques de este SKU", solo
// lectura) -- reusa la búsqueda de productVariantService.findVariantConfigBySkuCode (misma
// receta que ve el autofill de variantes) y la aplana a una lista con rol + cantidad, ver
// packaging.service.ts::listPackagingUsageBySkuCode.
export const packagingSkuUsageItemSchema = z.object({
    packagingId: z.number().int(),
    code: z.string(),
    displayName: z.string(),
    packagingRole: packagingRoleEnum,
    unitCost: z.number().nullable(),
    quantity: z.number(),
})

export type CreatePackagingInput = z.infer<typeof createPackagingSchema>
export type UpdatePackagingInput = z.infer<typeof updatePackagingSchema>
export type PackagingQuery = z.infer<typeof packagingQuerySchema>
export type PackagingSkuUsageItem = z.infer<typeof packagingSkuUsageItemSchema>
