import * as catalog from "./juice.schema"

describe("juice input contracts", () => {
    test.each(["LIBRA", "LITRO", "GRAMO"])("retains purchase unit %s and forbids supplying derived cost", purchaseUnit => {
        const input = { code: " CARROT ", displayName: " Carrot ", purchaseUnit, yieldPoundsPerLiter: 2.2, costPerUnit: 0.75 }
        expect(catalog.createJuiceRawMaterialSchema.parse(input).code).toBe("CARROT")
        expect(catalog.createJuiceRawMaterialSchema.safeParse({ ...input, costPerLiter: 1.65 }).success).toBe(false)
        expect(catalog.updateJuiceRawMaterialSchema.safeParse({ costPerUnit: 1 }).success).toBe(false)
    })
    test.each([0, -1, 1.0000001, 100000000])("rejects invalid yield precision/range: %s", yieldPoundsPerLiter => {
        expect(catalog.createJuiceRawMaterialSchema.safeParse({ code: "A", displayName: "A", purchaseUnit: "LIBRA", yieldPoundsPerLiter, costPerUnit: 1 }).success).toBe(false)
    })
    test("juice creation requires identity and client, without selling price or margin", () => {
        const input = { code: "CP", displayName: "Carrot Pineapple", clientId: 1 }
        expect(catalog.createJuiceSchema.safeParse(input).success).toBe(true)
        expect(catalog.createJuiceSchema.safeParse({ ...input, pricePerPound: 0 }).success).toBe(false)
        expect(catalog.updateJuiceSchema.safeParse({ displayName: "New" }).success).toBe(false)
        expect(catalog.createJuiceSchema.safeParse({ ...input, marginPerCase: 2.4 }).success).toBe(false)
    })
    test("recipe rows keep fixed identities on update", () => {
        expect(catalog.updateJuiceMixSchema.safeParse({ percentage: 50 }).success).toBe(true)
        expect(catalog.updateJuiceMixSchema.safeParse({ percentage: 50, rawMaterialId: 2 }).success).toBe(false)
        expect(catalog.updateJuiceSpiceSchema.safeParse({ gramsPerLiter: 2, spiceMaterialId: 2 }).success).toBe(false)
        expect(catalog.createJuiceMixSchema.safeParse({ juiceId: 1, rawMaterialId: 1, percentage: 100.000001 }).success).toBe(false)
    })
    test.each(["0", "-1", "1.5", "abc", "2147483648"])("rejects invalid route id %s", id => {
        expect(catalog.juiceIdParamSchema.safeParse({ id }).success).toBe(false)
    })
})
