import { createPackagingSchema, updatePackagingSchema, importLegacyPackagingSchema } from "./packaging.schema"
import { getPackagingVolumeLimits } from "./packagingVolumePricing.schema"

const base = { code: "BAG-1", displayName: "Bag", displayNameEn: "Bag", classification: "specific", packagingRole: "unit", unitCost: 0.12 }
const tiers = { lowVolumeMaximumQuantity: 5000, mediumVolumeMaximumQuantity: 25000, mediumVolumeUnitCost: 0.10, highVolumeUnitCost: 0.08 }

describe.each([createPackagingSchema, updatePackagingSchema, importLegacyPackagingSchema])("inclusive volume range form/import contract (%#)", schema => {
    test.each([
        {}, tiers, { lowVolumeMaximumQuantity: 6000, mediumVolumeMaximumQuantity: 30000 },
        { mediumVolumeUnitCost: 0.10 }, { highVolumeUnitCost: 0 },
        { ...tiers, mediumVolumeUnitCost: 0.12, highVolumeUnitCost: 0.12 },
        { ...tiers, mediumVolumeUnitCost: null, highVolumeUnitCost: null },
        { mediumVolumeMinimumQuantity: 25000, highVolumeMinimumQuantity: 50000, mediumVolumeUnitCost: 0.1, highVolumeUnitCost: 0.08 },
    ])("accepts configured upper bounds, optional costs and legacy references %j", prices => {
        expect(schema.safeParse({ ...base, ...prices }).success).toBe(true)
    })
    test.each([
        { lowVolumeMaximumQuantity: 0 }, { lowVolumeMaximumQuantity: -1 }, { lowVolumeMaximumQuantity: 5000.001 },
        { ...tiers, mediumVolumeMaximumQuantity: 5000 }, { ...tiers, mediumVolumeMaximumQuantity: 4000 },
        { ...tiers, mediumVolumeMaximumQuantity: Infinity }, { ...tiers, mediumVolumeMaximumQuantity: 25000.001 },
        { ...tiers, mediumVolumeUnitCost: -0.1 }, { ...tiers, highVolumeUnitCost: 0.1234567890123 },
        { ...tiers, highVolumeUnitCost: NaN }, { mediumVolumeMinimumQuantity: 4000 },
    ])("rejects invalid prices and unordered inclusive limits %j", prices => {
        expect(schema.safeParse({ ...base, ...prices }).success).toBe(false)
    })
    test("generic materials retain only their base cost", () => {
        expect(schema.safeParse({ ...base, code: undefined, classification: "generic" }).success).toBe(true)
        for (const prices of [tiers, { lowVolumeMaximumQuantity: 5000 }, { mediumVolumeMaximumQuantity: 25000 }, { highVolumeUnitCost: 0 }]) {
            expect(schema.safeParse({ ...base, code: undefined, classification: "generic", ...prices }).success).toBe(false)
        }
    })
})

test("approved defaults, legacy references and explicit upper bounds have deterministic precedence", () => {
    expect(getPackagingVolumeLimits({})).toEqual({ low: 5000, medium: 25000, high: null, fourth: null })
    expect(getPackagingVolumeLimits({ lowVolumeMaximumQuantity: 6000, mediumVolumeMinimumQuantity: 30000 })).toEqual({ low: 6000, medium: 30000, high: null, fourth: null })
    expect(getPackagingVolumeLimits({ mediumVolumeMaximumQuantity: 28000, mediumVolumeMinimumQuantity: 30000 })).toEqual({ low: 5000, medium: 28000, high: null, fourth: null })
})

describe.each([createPackagingSchema, updatePackagingSchema, importLegacyPackagingSchema])("four-tier contract (%#)", schema => {
    const fourTiers = { lowVolumeMaximumQuantity: 5000, mediumVolumeMaximumQuantity: 10000, highVolumeMaximumQuantity: 15000, fourthVolumeMaximumQuantity: 20000, fourthVolumeUnitCost: 0.06 }
    test.each([fourTiers, { ...fourTiers, fourthVolumeUnitCost: 0 }, { ...fourTiers, fourthVolumeUnitCost: null }, { ...fourTiers, fourthVolumeUnitCost: 0.12 }])("accepts an optional fourth price, including zero %j", fields => {
        expect(schema.safeParse({ ...base, ...fields }).success).toBe(true)
    })
    test.each([
        { highVolumeMaximumQuantity: 10000 }, { highVolumeMaximumQuantity: 15000.001 },
        { fourthVolumeMaximumQuantity: 15000 }, { fourthVolumeMaximumQuantity: 0 },
        { fourthVolumeUnitCost: -1 }, { fourthVolumeUnitCost: 0.1234567890123 },
        { highVolumeMaximumQuantity: null },
    ])("rejects invalid fourth-tier limits and costs %j", fields => {
        expect(schema.safeParse({ ...base, ...fourTiers, ...fields }).success).toBe(false)
    })
    test("requires a third limit before accepting a fourth price and rejects tiers for generics", () => {
        expect(schema.safeParse({ ...base, fourthVolumeUnitCost: 0 }).success).toBe(false)
        expect(schema.safeParse({ ...base, ...fourTiers, classification: "generic", code: undefined }).success).toBe(false)
    })
})
