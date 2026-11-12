import Decimal from "decimal.js"
import Packaging from "../../packaging/models/Packaging.model"
import { resolvePackagingCost } from "./packagingVolumePricing"
import { buildUnitMaterialLine, buildIntermediateMaterialLine, buildPalletMaterialLine } from "./quoteCostLines"

const prices = () => ({ code: "BAG-1", classification: "specific", unitCost: "0.12", lowVolumeMaximumQuantity: "5000", mediumVolumeMaximumQuantity: "25000", mediumVolumeUnitCost: "0.10", highVolumeMinimumQuantity: "50000", highVolumeUnitCost: "0.08" })
const fourTierPrices = () => ({ ...prices(), mediumVolumeMaximumQuantity: "10000", highVolumeMaximumQuantity: "15000", fourthVolumeMaximumQuantity: "20000", fourthVolumeUnitCost: "0.06" })

test.each([
    [1, "base", "0.12"], [5000, "base", "0.12"], [5000.01, "medium", "0.1"],
    [10000, "medium", "0.1"], [10000.01, "high", "0.08"], [15000, "high", "0.08"],
    [15000.01, "fourth", "0.06"], [20000, "fourth", "0.06"], [20000.01, "fourth", "0.06"], [80000, "fourth", "0.06"],
])("selects one price for all material at the four-tier boundary %s", (quantity, tier, cost) => {
    const result = resolvePackagingCost(fourTierPrices(), new Decimal(quantity))
    expect(result.unitCost.toString()).toBe(cost)
    expect(result.volumePricing).toMatchObject({ tier, priceTier: tier, materialQuantity: quantity })
    if (tier === "fourth") expect(result.volumePricing).toMatchObject({ minimumQuantity: 15000, maximumQuantity: null, referenceMaximumQuantity: 20000 })
})

test.each([
    [{ fourthVolumeUnitCost: null }, "high", "0.08"],
    [{ fourthVolumeUnitCost: null, highVolumeUnitCost: null }, "medium", "0.1"],
    [{ fourthVolumeUnitCost: null, highVolumeUnitCost: null, mediumVolumeUnitCost: null }, "base", "0.12"],
    [{ fourthVolumeUnitCost: "0" }, "fourth", "0"],
    [{ fourthVolumeUnitCost: "0.12" }, "fourth", "0.12"],
])("fourth-tier fallback preserves explicit zero and equal costs %j", (overrides, priceTier, cost) => {
    const result = resolvePackagingCost({ ...fourTierPrices(), ...overrides }, new Decimal(20001))
    expect(result.unitCost.toString()).toBe(cost)
    expect(result.volumePricing).toMatchObject({ tier: "fourth", priceTier })
})

test("the fourth price cannot apply to a lower tier and retains twelve-decimal PostgreSQL precision", () => {
    const packaging = { ...fourTierPrices(), mediumVolumeUnitCost: null, highVolumeUnitCost: null,
        fourthVolumeUnitCost: Number("12345.123456789012"), getDataValue: (field: string) => field === "fourthVolumeUnitCost" ? "12345.123456789012" : undefined }
    expect(resolvePackagingCost(packaging, new Decimal(15000)).unitCost.toString()).toBe("0.12")
    expect(resolvePackagingCost(packaging, new Decimal(15000.01)).unitCost.toString()).toBe("12345.123456789012")
})

test.each([
    { highVolumeMaximumQuantity: "10000" }, { fourthVolumeMaximumQuantity: "15000" },
    { fourthVolumeUnitCost: "NaN" }, { fourthVolumeUnitCost: "-1" },
])("rejects corrupt fourth-tier catalog data %j", overrides => {
    expect(() => resolvePackagingCost({ ...fourTierPrices(), ...overrides }, new Decimal(20000))).toThrow(expect.objectContaining({ key: "errors.packaging_volume_pricing_invalid" }))
})

test("all packaging levels select the fourth tier using their actual consumption", () => {
    const packaging = { ...fourTierPrices(), displayName: "Label", packagingRole: "unit", isActive: true } as unknown as Packaging
    const unit = buildUnitMaterialLine(1, packaging, null, 2, 8000)
    const intermediate = buildIntermediateMaterialLine(1, { ...packaging, packagingRole: "intermediate" } as Packaging, null, 10, 150001)
    const pallet = buildPalletMaterialLine(1, { ...packaging, packagingRole: "pallet" } as Packaging, null, 160, 100)
    expect(unit).toMatchObject({ unitCost: 0.06, lineTotal: 960, volumePricing: { tier: "fourth", materialQuantity: 16000 } })
    expect(intermediate).toMatchObject({ packagesNeeded: 15001, unitCost: 0.06, lineTotal: 900.06, volumePricing: { tier: "fourth", materialQuantity: 15001 } })
    expect(pallet).toMatchObject({ unitCost: 0.06, lineTotal: 960, volumePricing: { tier: "fourth", materialQuantity: 16000 } })
    const otherProduct = buildUnitMaterialLine(1, packaging, null, 1, 8000)
    expect(otherProduct).toMatchObject({ unitCost: 0.1, volumePricing: { tier: "medium" } })
    packaging.fourthVolumeUnitCost = 9
    expect(unit).toMatchObject({ unitCost: 0.06, lineTotal: 960 })
})

test("editing four limits preserves their inclusive boundaries", () => {
    const packaging = { ...fourTierPrices(), lowVolumeMaximumQuantity: "6000", mediumVolumeMaximumQuantity: "12000", highVolumeMaximumQuantity: "18000", fourthVolumeMaximumQuantity: "24000" }
    for (const [quantity, tier] of [[6000, "base"], [6000.01, "medium"], [12000, "medium"], [12000.01, "high"], [18000, "high"], [18000.01, "fourth"], [24000, "fourth"], [24000.01, "fourth"]] as const) {
        expect(resolvePackagingCost(packaging, new Decimal(quantity)).volumePricing?.tier).toBe(tier)
    }
})

test.each([
    [1, "base", "0.12"], [912, "base", "0.12"], [5000, "base", "0.12"],
    [5000.01, "medium", "0.1"], [5001, "medium", "0.1"], [5472, "medium", "0.1"], [24999.99, "medium", "0.1"], [25000, "medium", "0.1"],
    [25000.01, "high", "0.08"], [25001, "high", "0.08"], [49999.99, "high", "0.08"], [50000, "high", "0.08"], [50001, "high", "0.08"], [80000, "high", "0.08"], [100000, "high", "0.08"],
])("classifies inclusive upper bounds at %s pieces", (quantity, tier, cost) => {
    const result = resolvePackagingCost(prices(), new Decimal(quantity))
    expect(result.unitCost.toString()).toBe(cost)
    expect(result.volumePricing).toMatchObject({ tier, materialQuantity: quantity })
})

test("missing high tier falls back to medium and a single price applies to every quantity", () => {
    const mediumOnly = { ...prices(), highVolumeMinimumQuantity: null, highVolumeUnitCost: null }
    expect(resolvePackagingCost(mediumOnly, new Decimal(50000)).volumePricing).toMatchObject({ tier: "high", priceTier: "medium" })
    const baseOnly = { ...mediumOnly, mediumVolumeMinimumQuantity: null, mediumVolumeUnitCost: null }
    for (const quantity of [5000, 25000, 50000]) expect(resolvePackagingCost(baseOnly, new Decimal(quantity)).unitCost.toString()).toBe("0.12")
})

test("a missing middle tier never applies the high-volume cost below its minimum", () => {
    const highOnly = { ...prices(), mediumVolumeMinimumQuantity: null, mediumVolumeUnitCost: null }
    expect(resolvePackagingCost(highOnly, new Decimal(25000)).volumePricing).toMatchObject({ tier: "medium", priceTier: "base" })
    expect(resolvePackagingCost(highOnly, new Decimal(50000)).volumePricing?.tier).toBe("high")
})

test("equal prices are valid and a recorded zero is not a missing cost", () => {
    expect(resolvePackagingCost({ ...prices(), highVolumeUnitCost: "0" }, new Decimal(50000)).unitCost.toNumber()).toBe(0)
    expect(resolvePackagingCost({ ...prices(), mediumVolumeUnitCost: "0.12", highVolumeUnitCost: "0.12" }, new Decimal(50000)).unitCost.toNumber()).toBe(0.12)
})

test.each([
    [5000, "unitCost"], [25000, "mediumVolumeUnitCost"], [50000, "highVolumeUnitCost"],
] as const)("preserves PostgreSQL cost precision for %s pieces", (quantity, selectedField) => {
    const exactCost = "12345.123456789012"
    const packaging = {
        ...prices(),
        [selectedField]: Number(exactCost),
        getDataValue: (field: string) => field === selectedField ? exactCost : undefined,
    }
    const result = resolvePackagingCost(packaging, new Decimal(quantity))
    expect(result.unitCost.toString()).toBe(exactCost)
    expect(result.unitCost.times(quantity).toString()).toBe(new Decimal(exactCost).times(quantity).toString())
})

test("plain stored numeric strings retain all twelve decimal places", () => {
    const result = resolvePackagingCost({ ...prices(), mediumVolumeUnitCost: "12345.123456789012" }, new Decimal(25000))
    expect(result.unitCost.toString()).toBe("12345.123456789012")
})

test("generic materials keep their base cost and do not receive specific volume metadata", () => {
    const result = resolvePackagingCost({ ...prices(), classification: "generic" }, new Decimal(50000))
    expect(result.unitCost.toNumber()).toBe(0.12)
    expect(result.volumePricing).toBeUndefined()
})

test.each([
    { mediumVolumeMaximumQuantity: "5000" }, { lowVolumeMaximumQuantity: "30000" },
    { unitCost: null }, { highVolumeUnitCost: "NaN" },
])("rejects invalid persisted pricing instead of silently discounting %j", invalid => {
    expect(() => resolvePackagingCost({ ...prices(), ...invalid }, new Decimal(50000))).toThrow(expect.objectContaining({ key: "errors.packaging_volume_pricing_invalid" }))
})

test.each([0, -1, Infinity, NaN])("rejects invalid required material quantity %s", quantity => {
    expect(() => resolvePackagingCost(prices(), new Decimal(quantity))).toThrow()
})

const material = (role: string) => ({ ...prices(), displayName: "Material", displayNameEn: "Material", packagingRole: role, isActive: true }) as unknown as Packaging

test("individual consumption determines the tier and the chosen cost applies to all pieces", () => {
    const line = buildUnitMaterialLine(1, material("unit"), null, 2, 12500)
    expect(line).toMatchObject({ unitCost: 0.10, lineTotal: 2500, volumePricing: { tier: "medium", materialQuantity: 25000, minimumQuantity: 5000, maximumQuantity: 25000, minimumExclusive: true } })
})

test("intermediate packages select their tier after rounding the package count up", () => {
    const line = buildIntermediateMaterialLine(1, material("intermediate"), null, 10, 249991)
    expect(line).toMatchObject({ packagesNeeded: 25000, unitCost: 0.10, lineTotal: 2500, volumePricing: { tier: "medium", materialQuantity: 25000 } })
})

test("pallet materials use their own consumption, including labels per box", () => {
    const line = buildPalletMaterialLine(1, material("pallet"), null, 160, 157)
    expect(line).toMatchObject({ unitCost: 0.08, lineTotal: 2009.6, volumePricing: { tier: "high", materialQuantity: 25120 } })
})

test("each product is priced independently and saved line values do not change with catalog prices", () => {
    const packaging = material("unit")
    const first = buildUnitMaterialLine(1, packaging, null, 1, 3000)
    const second = buildUnitMaterialLine(1, packaging, null, 1, 3000)
    expect([first.unitCost, second.unitCost]).toEqual([0.12, 0.12])
    packaging.unitCost = 1
    expect(first).toMatchObject({ unitCost: 0.12, lineTotal: 360, volumePricing: { tier: "base" } })
})

test("legacy 25000/50000 references no longer delay the middle or cheapest prices", () => {
    const legacy = { code: "LEGACY", classification: "specific", unitCost: 3, mediumVolumeMinimumQuantity: 25000, mediumVolumeUnitCost: 2, highVolumeMinimumQuantity: 50000, highVolumeUnitCost: 1 }
    expect(resolvePackagingCost(legacy, new Decimal(5472))).toMatchObject({ volumePricing: { tier: "medium", priceTier: "medium" } })
    expect(resolvePackagingCost(legacy, new Decimal(25001)).unitCost.toNumber()).toBe(1)
})

test("edited limits change the inclusive boundaries without rounding quantities", () => {
    const edited = { ...prices(), lowVolumeMaximumQuantity: "6000", mediumVolumeMaximumQuantity: "30000" }
    for (const [quantity,tier] of [[6000,"base"],[6000.01,"medium"],[30000,"medium"],[30000.01,"high"]] as const) expect(resolvePackagingCost(edited,new Decimal(quantity)).volumePricing?.tier).toBe(tier)
})
