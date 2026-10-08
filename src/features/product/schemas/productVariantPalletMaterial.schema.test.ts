import { createProductVariantPalletMaterialSchema, updateProductVariantPalletMaterialSchema } from "./productVariantPalletMaterial.schema"

const input = { productVariantId: 1, packagingId: 2, quantityBasis: "per_box", quantityValue: 1, optionGroupId: 4 }
it("accepts catalog box and corner alternatives with explicit quantities", () => {
    expect(createProductVariantPalletMaterialSchema.parse(input)).toMatchObject(input)
    expect(createProductVariantPalletMaterialSchema.parse({ ...input, quantityBasis: "per_pallet", quantityValue: 4, optionGroupId: 5 })).toMatchObject({ optionGroupId: 5, quantityValue: 4 })
})
it("requires explicit quantity basis on create and update", () => {
    const { quantityBasis: _quantityBasis, ...missing } = input
    expect(createProductVariantPalletMaterialSchema.safeParse(missing).success).toBe(false)
    expect(updateProductVariantPalletMaterialSchema.safeParse(missing).success).toBe(false)
    expect(createProductVariantPalletMaterialSchema.safeParse({ ...input, quantityBasis: "per_unit" }).success).toBe(false)
})

it("allows both rule fields to be omitted for catalog resolution and persisted-rule preservation", () => {
    expect(createProductVariantPalletMaterialSchema.safeParse({ productVariantId: 1, packagingId: 2 }).success).toBe(true)
    expect(updateProductVariantPalletMaterialSchema.safeParse({ packagingId: 2, optionGroupId: null, optionGroup: null, isDefault: false }).success).toBe(true)
})
