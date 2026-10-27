jest.mock("../../processingCost/models/ProcessingCost.model", () => ({ __esModule: true, default: {} }))
jest.mock("../../processingCost/models/ProcessingCostTranslation.model", () => ({ __esModule: true, default: {} }))

import Decimal from "decimal.js"
import Ingredient from "../../ingredient/models/Ingredient.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import { buildIngredientLine, buildPercentageRawMaterialLine } from "./quoteCostLines"

const unit = { unitType: "weight", baseFactor: 453.592, unitCode: "lb" }
const material = (costPerUnit: unknown) => ({ displayName: "Test", costPerUnit, costUnit: unit })

describe("required costs in shared quote calculations", () => {
    it.each([null, undefined])("rejects absent ingredient and raw material cost %s", cost => {
        expect(() => buildIngredientLine(1, material(cost) as Ingredient, 2, 1000, new Decimal(500), 100, new Decimal(100), "es"))
            .toThrow(expect.objectContaining({ statusCode: 422, key: "errors.ingredient_missing_cost" }))
        expect(() => buildPercentageRawMaterialLine(1, material(cost) as RawMaterial, new Decimal(60), new Decimal(500), 100, new Decimal(100), "es"))
            .toThrow(expect.objectContaining({ statusCode: 422, key: "errors.raw_material_missing_cost" }))
    })
    it.each([0, "0.0000"])("accepts explicit zero %s", cost => {
        expect(buildIngredientLine(1, material(cost) as Ingredient, 2, 1000, new Decimal(500), 100, new Decimal(100), "es").lineTotal).toBe(0)
        expect(buildPercentageRawMaterialLine(1, material(cost) as RawMaterial, new Decimal(60), new Decimal(500), 100, new Decimal(100), "es").lineTotal).toBe(0)
    })
    it.each([[500, 1, 2.2046], [1000, 2, 4.4092]])("preserves proportional scaling and rounding at %s g", (weight, gramsPerUnit, expected) => {
        const line = buildIngredientLine(1, material(10) as Ingredient, 2, 1000, new Decimal(weight), 100, new Decimal(100), "es")
        expect(line.gramsPerUnit).toBe(gramsPerUnit)
        expect(line.lineTotal).toBe(expected)
    })
})
