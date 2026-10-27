jest.mock("../../../database/connection", () => ({ __esModule: true, default: {} }))
jest.mock("../models/JuiceMix.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/JuiceSpice.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
import Mix from "../models/JuiceMix.model"
import Spice from "../models/JuiceSpice.model"
import { loadJuiceRecipe } from "./juiceRecipe.service"
let row: any
beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(Mix.findAll).mockResolvedValue([{ rawMaterialId: 1, percentage: 100, rawMaterial: { isActive: true, displayName: "Synthetic raw", costPerLiter: 2 } }] as never)
    row = { ingredientId: 7, gramsPerLiter: .35, ingredient: { id: 7, displayName: "Synthetic ingredient", isActive: true, costPerUnit: "453.592", costUnit: { isActive: true, unitType: "weight", baseFactor: "453.592" } } }
    jest.mocked(Spice.findAll).mockImplementation(async () => [row])
})
test("shared ingredients convert their catalog purchase unit to cost per gram", async () => {
    const { recipe, ingredientRows } = await loadJuiceRecipe(1)
    expect(recipe.spices).toEqual([{ spiceMaterialId: 7, displayName: "Synthetic ingredient", gramsPerLiter: .35, costPerGram: "1" }])
    expect(ingredientRows[0].ingredientId).toBe(7)
})
test.each(["inactive", "volume", "zero factor", "missing cost"])("invalid shared ingredient %s is rejected", async reason => {
    if (reason === "inactive") row.ingredient.isActive = false
    if (reason === "volume") row.ingredient.costUnit.unitType = "volume"
    if (reason === "zero factor") row.ingredient.costUnit.baseFactor = 0
    if (reason === "missing cost") row.ingredient.costPerUnit = null
    await expect(loadJuiceRecipe(1)).rejects.toMatchObject({ statusCode: 422 })
})
test("legacy spices remain readable but cannot be silently used by the integrated quote", async () => {
    row = { ingredientId: null, spiceMaterialId: 3, gramsPerLiter: 1, spiceMaterial: { isActive: true, displayName: "Synthetic legacy", costPerGram: .1 } }
    await expect(loadJuiceRecipe(1)).rejects.toMatchObject({ key: "errors.juice_shared_ingredients_required" })
    expect((await loadJuiceRecipe(1, true)).recipe.spices[0].costPerGram).toBe(.1)
})
