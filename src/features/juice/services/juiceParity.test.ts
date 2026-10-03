import { buildJuiceCostLines } from "./juiceCostLines"
import { parityRecipe as recipe, parityPhysical as physical, parityConstants as constants } from "./juiceParity.fixture"
import { calculateJuiceQuoteSchema } from "../schemas/juiceQuote.schema"
import { createJuiceSchema, createJuiceSpiceMaterialSchema, createJuicePresentationSchema, createJuiceRawMaterialSchema } from "../schemas/juice.schema"

const calculate = () => buildJuiceCostLines(recipe, physical, constants, "2.025852", 1)
describe("CARROT PINEAPPLE JUICE 6x354 ML — corrected Mode A", () => {
    test("computes raw material from volume recipe plus ginger, with valid own-press zero cost", () => {
        const result = calculate()
        expect(result.liquidCostPerLiter).toBeCloseTo(0.5485508, 12)
        expect(result.spiceCostPerLiter).toBeCloseTo(0.00983680416495, 12)
        expect(result.rawMaterialCostPerLiter).toBeCloseTo(0.55838760416495, 12)
        expect(result.rawMaterialCostPerPound).toBeCloseTo(0.253282955713, 12)
        // Supplied carrot cost was marked approximate. Never force/truncate the recipe
        // to its displayed 0.2532829 target or reproduce the broken 0.009837 HLOOKUP.
        expect(Math.abs(result.rawMaterialCostPerPound - 0.2532829)).toBeLessThan(0.0000001)
        expect(result.lines[0].costPerPound).toBeCloseTo(-0.253282955713, 12)
        expect(result.recipe.rawMaterials[1].contributionPerLiter).toBe(0)
    })
    test("uses exact physical inputs, packaging recovery and pounds/container divisor", () => {
        const result = calculate()
        expect(result.poundsPerCase).toBe(4.6825704)
        expect(result.casesPerContainer).toBe(8480)
        expect(result.poundsPerContainer).toBe(39708.196992)
        const expected = {
            emptyBox: -0.070628, sticker: -0.196977, bottles: -0.229440, caps: -0.019980,
            directLabor: -0.07, indirectLabor: -0.035, financial: 0, fixed: 0, electricity: -0.02,
            cleaning: -0.01, laboratory: -0.01, hpp: -0.045,
            palletizing: -0.011333, localClearing: -0.001486, containerFreight: -0.128689,
            miamiClearing: -0.003778, storage: -0.033243, inOut: 0, accesorial: 0, logisticMovement: 0,
            unexpected: -0.040517, portFee: -0.002532, salesmanCommission: -0.131680, distributorCommission: -0.030388,
        }
        for (const [key, value] of Object.entries(expected)) {
            expect(result.lines.find(row => row.key === key)?.costPerPound).toBeCloseTo(value, 6)
        }
        expect(result.lines).toHaveLength(26)
    })
    test("tariff includes corrected raw through HPP; fixed independent oracle verifies all totals", () => {
        // Oracle values independently recomputed with Python Decimal from the supplied inputs.
        const result = calculate()
        expect(result.tariffBasePerPound).toBeCloseTo(-1.0136436014612, 12)
        expect(result.lines.find(row => row.key === "tariff")?.costPerPound).toBeCloseTo(-0.10136436014612, 12)
        expect(result.totalCostPerPound).toBe(-1.4453)
        expect(result.costPerCase).toBe(-6.7678)
        expect(result.pricePerCase).toBe(9.1678)
        expect(result.pricePerPound).toBe(1.9579)
        expect(result.grossMarginPerPound).toBe(0.5805)
        expect(result.exteriorCostPerPound).toBeCloseTo(-0.2999933137308, 12)
        expect(result.exworksCostPerCase).toBe(-5.3631)
        expect(result.exworksPricePerCase).toBe(8.0815)
        expect(result.inputPricePerPound).toBe(2.025852)
        expect(result.totalCost).toBe(-6.7678)
        expect(result.totalPrice).toBe(9.1678)
    })
    test("margin changes derived price without changing input-price commissions or tariff", () => {
        const baseline = calculate()
        const changed = buildJuiceCostLines(recipe, { ...physical, marginPerCase: 4.4 }, constants, 2.025852, 1)
        expect(changed.lines).toEqual(baseline.lines)
        expect(changed.pricePerCase).toBe(11.1678)
        expect(changed.costPerCase).toBe(baseline.costPerCase)
        expect(changed.exworksPricePerCase).toBe(baseline.exworksPricePerCase)
    })
    test("requested cases scale totals only, retaining full-container cost allocation", () => {
        const baseline = calculate()
        const result = buildJuiceCostLines(recipe, physical, constants, 2.025852, 10)
        expect(result.costPerCase).toBe(baseline.costPerCase)
        expect(result.totalCost).toBe(-67.678)
        expect(result.totalPrice).toBe(91.678)
        expect(result.totalMargin).toBe(24)
        expect(result.totalPounds).toBe(46.825704)
    })
    test("zero/null layering resolved upstream remains valid for production and logistics", () => {
        const result = buildJuiceCostLines(recipe, physical, { ...constants, freightPerContainer: 0, directLaborPerPound: 0 }, 2.025852, 1)
        expect(result.lines.find(row => row.key === "containerFreight")?.costPerPound).toBe(0)
        expect(result.lines.find(row => row.key === "directLabor")?.costPerPound).toBe(0)
        expect(result.costPerCase).toBeGreaterThan(calculate().costPerCase)
    })
    test("catalog schemas accept every source value without four/six-place truncation", () => {
        expect(createJuiceSchema.parse({ code: "CP", displayName: "CP", clientId: 1, pricePerPound: 2.025852 }).pricePerPound).toBe(2.025852)
        expect(createJuiceSpiceMaterialSchema.parse({ code: "G", displayName: "Ginger", costPerGram: 0.028105154757 }).costPerGram).toBe(0.028105154757)
        expect(createJuiceRawMaterialSchema.parse({ code: "O", displayName: "Orange", purchaseUnit: "LIBRA", yieldPoundsPerLiter: 1, costPerUnit: 1.87391 }).costPerUnit).toBe(1.87391)
        expect(createJuicePresentationSchema.parse({ juiceId: 1, displayLabel: "6x354", ...Object.fromEntries(Object.entries(physical).map(([key, value]) => [key, Number(value)])) }).bottleUnitCost).toBe(0.173689978)
    })
})

describe("juice calculation guardrails", () => {
    test.each([[], [{ ...recipe.rawMaterials[0], percentage: 99 }], [{ ...recipe.rawMaterials[0], percentage: 100.000001 }]].map(rawMaterials => ({ rawMaterials })))("rejects an incomplete/invalid recipe", ({ rawMaterials }) => {
        expect(() => buildJuiceCostLines({ ...recipe, rawMaterials }, physical, constants, 2, 1)).toThrow()
    })
    test("rejects duplicate recipe rows and negative source costs", () => {
        expect(() => buildJuiceCostLines({ ...recipe, rawMaterials: [recipe.rawMaterials[0], recipe.rawMaterials[0]] }, physical, constants, 2, 1)).toThrow()
        expect(() => buildJuiceCostLines({ ...recipe, spices: [{ ...recipe.spices[0], costPerGram: -1 }] }, physical, constants, 2, 1)).toThrow()
    })
    test.each([0, -1, 0.5, NaN, Infinity])("rejects invalid case quantity %s", quantity => {
        expect(() => buildJuiceCostLines(recipe, physical, constants, 2, quantity)).toThrow()
        expect(calculateJuiceQuoteSchema.safeParse({ juiceId: 1, presentationId: 1, quantity }).success).toBe(false)
    })
    test("rejects missing/zero physical divisors and out-of-range rates", () => {
        expect(() => buildJuiceCostLines(recipe, { ...physical, mlPerBottle: 0 }, constants, 2, 1)).toThrow()
        expect(() => buildJuiceCostLines(recipe, physical, { ...constants, palletsPerContainer: 0 }, 2, 1)).toThrow()
        expect(() => buildJuiceCostLines(recipe, physical, { ...constants, tariffRate: 10 }, 2, 1)).toThrow()
        expect(() => buildJuiceCostLines(recipe, physical, constants, 0, 1)).toThrow()
        expect(calculateJuiceQuoteSchema.safeParse({ juiceId: 1, presentationId: 1, quantity: 1, pricePerPound: 1 }).success).toBe(false)
    })
})
