import { buildJuiceCostLines } from "./juiceCostLines"
import { parityRecipe as recipe, parityPhysical as physical } from "./juiceParity.fixture"
import { createJuiceSchema, createJuiceSpiceMaterialSchema, createJuicePresentationSchema, createJuiceRawMaterialSchema } from "../schemas/juice.schema"

const calculate = () => buildJuiceCostLines(recipe, physical, 1)
describe("juice direct costs: raw materials, ingredients and packaging only", () => {
    test("preserves recipe conversion and zero-cost own-press inputs", () => {
        const result = calculate()
        expect(result.liquidCostPerLiter).toBeCloseTo(0.5485508, 12)
        expect(result.spiceCostPerLiter).toBeCloseTo(0.00983680416495, 12)
        expect(result.rawMaterialCostPerLiter).toBeCloseTo(0.55838760416495, 12)
        expect(result.rawMaterialCostPerPound).toBeCloseTo(0.253282955713, 12)
        expect(result.recipe.rawMaterials[1].contributionPerLiter).toBe(0)
    })
    test("includes actual unit packaging amounts without a recovery surcharge", () => {
        const result = calculate()
        expect(result.poundsPerCase).toBe(4.6825704)
        expect(result.lines.map(row => row.key)).toEqual(["rawMaterial", "spices", "emptyBox", "sticker", "bottles", "caps"])
        const expected = { emptyBox: 0.3208, sticker: 0.8947, bottles: 1.0421, caps: 0.0908 }
        for (const [key, value] of Object.entries(expected)) expect(result.lines.find(row => row.key === key)?.costPerCase).toBe(value)
        expect(result.lines.every(row => row.costPerPound >= 0)).toBe(true)
    })
    test("matches an independent Decimal oracle with no selling price or margin output", () => {
        // Python Decimal: recipe/liter * .354 * 6 + .3208 + 6*(.14911439+.173689978+.015125).
        const result = calculate()
        expect(result.costPerCase).toBe(3.5344)
        expect(result.totalCostPerPound).toBe(0.7548)
        expect(result.totalCost).toBe(3.5344)
        for (const key of ["pricePerCase", "pricePerPound", "inputPricePerPound", "marginPerCase", "grossMarginPerPound", "exworksPricePerCase", "configuration", "casesPerContainer"]) expect(result).not.toHaveProperty(key)
    })
    test("historical pricing and logistics metadata cannot influence direct costs", () => {
        const obsolete = { ...physical, marginPerCase: 9999, pricePerPound: 9999, portFeeRate: 1, freightPerContainer: 999999, directLaborPerPound: 999 }
        expect(buildJuiceCostLines(recipe, obsolete, 1)).toEqual(calculate())
    })
    test("case quantity scales unrounded totals before output rounding", () => {
        const result = buildJuiceCostLines(recipe, physical, 10)
        expect(result.costPerCase).toBe(3.5344)
        expect(result.totalCost).toBe(35.3439)
        expect(result.totalPounds).toBe(46.825704)
    })
    test("zero material and packaging costs remain valid", () => {
        const zeroRecipe = { rawMaterials: [{ rawMaterialId: 1, displayName: "Synthetic", percentage: 100, costPerLiter: 0 }], spices: [] }
        const zeroPhysical = { ...physical, boxUnitCost: 0, bottleUnitCost: 0, capUnitCost: 0, stickerUnitCost: 0, secondStickerUnitCost: 0 }
        expect(buildJuiceCostLines(zeroRecipe, zeroPhysical, 1)).toMatchObject({ totalCost: 0, costPerCase: 0 })
    })
    test("catalog contracts preserve source precision and reject retired price inputs", () => {
        const juice = { code: "SYN", displayName: "Synthetic", clientId: 1 }
        expect(createJuiceSchema.parse(juice)).toEqual(juice)
        expect(createJuiceSchema.safeParse({ ...juice, pricePerPound: 2 }).success).toBe(false)
        expect(createJuiceSpiceMaterialSchema.parse({ code: "G", displayName: "Ginger", costPerGram: 0.028105154757 }).costPerGram).toBe(0.028105154757)
        expect(createJuiceRawMaterialSchema.parse({ code: "O", displayName: "Orange", purchaseUnit: "LIBRA", yieldPoundsPerLiter: 1, costPerUnit: 1.87391 }).costPerUnit).toBe(1.87391)
        const input = { juiceId: 1, displayLabel: "6x354", ...Object.fromEntries(Object.entries(physical).map(([key, value]) => [key, Number(value)])) }
        expect(createJuicePresentationSchema.parse(input).bottleUnitCost).toBe(0.173689978)
        expect(createJuicePresentationSchema.safeParse({ ...input, marginPerCase: 2 }).success).toBe(false)
    })
})
describe("juice calculation guardrails", () => {
    test.each([[], [{ ...recipe.rawMaterials[0], percentage: 99 }], [{ ...recipe.rawMaterials[0], percentage: 100.000001 }]].map(rawMaterials => ({ rawMaterials })))("rejects incomplete recipes", ({ rawMaterials }) => {
        expect(() => buildJuiceCostLines({ ...recipe, rawMaterials }, physical, 1)).toThrow()
    })
    test("rejects duplicate raw/spice identities and negative source costs", () => {
        expect(() => buildJuiceCostLines({ ...recipe, rawMaterials: [recipe.rawMaterials[0], recipe.rawMaterials[0]] }, physical, 1)).toThrow()
        expect(() => buildJuiceCostLines({ ...recipe, spices: [recipe.spices[0], recipe.spices[0]] }, physical, 1)).toThrow()
        expect(() => buildJuiceCostLines({ ...recipe, spices: [{ ...recipe.spices[0], costPerGram: -1 }] }, physical, 1)).toThrow()
        expect(() => buildJuiceCostLines({ ...recipe, rawMaterials: [{ ...recipe.rawMaterials[0], percentage: 100, costPerLiter: -1 }] }, physical, 1)).toThrow()
    })
    test.each([0, -1, 0.5, NaN, Infinity])("rejects invalid case quantity %s", quantity => {
        expect(() => buildJuiceCostLines(recipe, physical, quantity)).toThrow()
    })
    test("rejects invalid bottle dimensions and negative packaging costs", () => {
        for (const patch of [{ mlPerBottle: 0 }, { bottlesPerCase: 0 }, { bottlesPerCase: 1.5 }, { boxUnitCost: -1 }, { stickerQuantityPerCase: -1 }]) expect(() => buildJuiceCostLines(recipe, { ...physical, ...patch }, 1)).toThrow()
    })
})
