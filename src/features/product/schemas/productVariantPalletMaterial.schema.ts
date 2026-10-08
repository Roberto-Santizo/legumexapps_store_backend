import z from "zod"

const palletMaterialFields = z.object({
    productVariantId: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    quantityValue: z.number().positive().max(99999999.99).optional(),
    quantityBasis: z.enum(["per_box", "per_pallet"]).optional(),
    optionGroupId: z.number().int().positive().nullable().default(null),
    optionGroup: z.string().trim().min(1).max(60).nullable().default(null),
    isDefault: z.boolean().default(false),
})

function validateRule(value: { quantityBasis?: string; quantityValue?: number }, ctx: z.RefinementCtx) {
    if ((value.quantityBasis != null) !== (value.quantityValue != null)) ctx.addIssue({ code: "custom", path: [value.quantityBasis ? "quantityValue" : "quantityBasis"], message: "errors.pallet_consumption_invalid" })
    if (value.quantityValue != null && Math.abs(value.quantityValue * 100 - Math.round(value.quantityValue * 100)) > 0.000001) ctx.addIssue({ code: "custom", path: ["quantityValue"], message: "errors.pallet_consumption_invalid" })
}
export const createProductVariantPalletMaterialSchema = palletMaterialFields.superRefine(validateRule)

export const productVariantPalletMaterialIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})


export const updateProductVariantPalletMaterialSchema = palletMaterialFields.partial().extend({
    quantityValue: palletMaterialFields.shape.quantityValue,
    quantityBasis: palletMaterialFields.shape.quantityBasis,
    optionGroupId: palletMaterialFields.shape.optionGroupId,
    optionGroup: palletMaterialFields.shape.optionGroup,
    isDefault: palletMaterialFields.shape.isDefault,
}).superRefine(validateRule)

export type CreateProductVariantPalletMaterialInput = z.infer<typeof createProductVariantPalletMaterialSchema>
export type UpdateProductVariantPalletMaterialInput = z.infer<typeof updateProductVariantPalletMaterialSchema>
