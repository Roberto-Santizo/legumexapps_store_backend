import { createPackagingSchema, updatePackagingSchema } from "../schemas/packaging.schema"
import { resolvePalletConsumptionRule } from "./packagingConsumption.service"

const input = { code: "NO-SEMANTIC-CODE", displayName: "Unclassified", packagingRole: "pallet", unitCost: 1 }
it.each([["per_box", 1], ["per_pallet", 4], ["per_pallet", 1], ["per_pallet", 93.3]] as const)("validates and resolves explicit catalog consumption %s / %s", (basis, quantity) => {
    const packaging = createPackagingSchema.parse({ ...input, defaultQuantityBasis: basis, defaultQuantityValue: quantity })
    expect(resolvePalletConsumptionRule(packaging)).toEqual({ quantityBasis: basis, quantityValue: quantity })
})
it.each([
    { defaultQuantityBasis: "per_box" }, { defaultQuantityValue: 1 },
    { defaultQuantityBasis: "per_box", defaultQuantityValue: null },
    { defaultQuantityBasis: null, defaultQuantityValue: 1 },
    { defaultQuantityBasis: "per_pallet", defaultQuantityValue: 0 },
    { defaultQuantityBasis: "per_pallet", defaultQuantityValue: -1 },
    { defaultQuantityBasis: "per_pallet", defaultQuantityValue: 1.001 },
    { defaultQuantityBasis: "per_unit", defaultQuantityValue: 1 },
])("rejects invalid or incomplete defaults %j in create and update", defaults => {
    expect(createPackagingSchema.safeParse({ ...input, ...defaults }).success).toBe(false)
    expect(updatePackagingSchema.safeParse({ ...input, ...defaults }).success).toBe(false)
})
it.each(["unit", "intermediate"])("role %s requires no pallet defaults and rejects pallet defaults", role => {
    expect(createPackagingSchema.safeParse({ ...input, packagingRole: role }).success).toBe(true)
    expect(createPackagingSchema.safeParse({ ...input, packagingRole: role, defaultQuantityBasis: null, defaultQuantityValue: null }).success).toBe(true)
    expect(createPackagingSchema.safeParse({ ...input, packagingRole: role, defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4 }).success).toBe(false)
})
it("allows unconfigured legacy catalog records but blocks new simplified associations", () => {
    const material = createPackagingSchema.parse(input)
    expect(() => resolvePalletConsumptionRule(material)).toThrow(expect.objectContaining({ key: "errors.packaging_consumption_missing", params: { code: input.code } }))
})
it("keeps a persisted override after the catalog default changes", () => {
    const existing = { quantityBasis: "per_pallet" as const, quantityValue: 7 }
    const catalog = { ...input, defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4 }
    expect(resolvePalletConsumptionRule(catalog, undefined, existing)).toEqual(existing)
    catalog.defaultQuantityValue = 5
    expect(resolvePalletConsumptionRule(catalog, undefined, existing)).toEqual(existing)
    expect(existing.quantityValue).toBe(7)
})
it("legacy override takes precedence and partial overrides cannot fall back to defaults", () => {
    const catalog = { ...input, defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4 }
    expect(resolvePalletConsumptionRule(catalog, { quantityBasis: "per_box", quantityValue: 1 })).toEqual({ quantityBasis: "per_box", quantityValue: 1 })
    expect(() => resolvePalletConsumptionRule(catalog, { quantityBasis: "per_box" })).toThrow(expect.objectContaining({ key: "errors.pallet_consumption_invalid" }))
})

it("does not repair invalid persisted associations from catalog defaults", () => {
    const catalog = { ...input, defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4 }
    expect(() => resolvePalletConsumptionRule(catalog, undefined, { quantityBasis: undefined, quantityValue: 7 } as unknown as Parameters<typeof resolvePalletConsumptionRule>[2])).toThrow()
})
