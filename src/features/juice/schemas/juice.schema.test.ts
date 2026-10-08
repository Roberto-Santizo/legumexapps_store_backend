import * as catalog from "./juice.schema"
import * as config from "./juiceConfig.schema"
import { JUICE_CONSTANT_FIELDS } from "../constants/juice.constant"

const globalInput = Object.fromEntries(JUICE_CONSTANT_FIELDS.map(key => [key, key === "palletsPerContainer" ? 20 : key.endsWith("Rate") ? 0.02 : 1]))

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
    test("PRICE LB is required, positive and independent of presentation margin", () => {
        const input = { code: "CP", displayName: "Carrot Pineapple", clientId: 1, pricePerPound: 2.125 }
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
    test("global updates require all fields; rates are fractions", () => {
        expect(config.createJuiceCostConstantsSchema.safeParse(globalInput).success).toBe(true)
        expect(config.updateJuiceCostConstantsSchema.safeParse({ freightPerContainer: 5000 }).success).toBe(false)
        expect(config.createJuiceCostConstantsSchema.safeParse({ ...globalInput, salesmanCommissionRate: 6.5 }).success).toBe(false)
        expect(config.createJuiceCostConstantsSchema.safeParse({ ...globalInput, palletsPerContainer: 0 }).success).toBe(false)
    })
    test("null restores inheritance, zero overrides and omission remains omission", () => {
        expect(config.createJuiceClientConstantOverrideSchema.parse({ clientId: 2, freightPerContainer: null, unexpectedRate: 0 })).toEqual({ clientId: 2, freightPerContainer: null, unexpectedRate: 0 })
        expect(config.updateJuiceClientConstantOverrideSchema.parse({ hppPerPound: null })).toEqual({ hppPerPound: null })
        expect(config.updateJuiceClientConstantOverrideSchema.safeParse({}).success).toBe(false)
        expect(config.updateJuiceClientConstantOverrideSchema.safeParse({ clientId: 3 }).success).toBe(false)
    })
    test.each(["0", "-1", "1.5", "abc", "2147483648"])("rejects invalid route id %s", id => {
        expect(catalog.juiceIdParamSchema.safeParse({ id }).success).toBe(false)
    })
})
