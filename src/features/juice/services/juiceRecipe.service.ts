import Mix from "../models/JuiceMix.model"
import Raw from "../models/JuiceRawMaterial.model"
import Spice from "../models/JuiceSpice.model"
import SpiceMaterial from "../models/JuiceSpiceMaterial.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import IngredientTranslation from "../../ingredient/models/IngredientTranslation.model"
import Unit from "../../unit/models/Unit.model"
import { AppError } from "../../../shared/errors/AppError"
import { toDecimal } from "../../../shared/utils/money.util"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE, pickTranslatedName } from "../../../shared/utils/translation.util"
import type { JuiceRecipeInput } from "./juiceCostLines"

export async function loadJuiceRecipe(juiceId: number, allowLegacy = false, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE) {
    const mix = await Mix.findAll({ where: { juiceId, isActive: true }, order: [["id", "ASC"]], include: [{ model: Raw, as: "rawMaterial", required: false }] })
    const spices = await Spice.findAll({ where: { juiceId, isActive: true }, order: [["id", "ASC"]], include: [
        { model: SpiceMaterial, as: "spiceMaterial", required: false },
        { model: Ingredient, as: "ingredient", required: false, include: [{ model: Unit, as: "costUnit" }, { model: IngredientTranslation, as: "translations" }] },
    ] })
    if (mix.some(row => !row.rawMaterial?.isActive)) throw new AppError(422, "errors.juice_invalid_recipe")
    const recipe: JuiceRecipeInput = {
        rawMaterials: mix.map(row => ({ rawMaterialId: row.rawMaterialId, displayName: row.rawMaterial.displayName, percentage: row.percentage, costPerLiter: row.rawMaterial.costPerLiter })),
        spices: spices.map(row => {
            if (row.ingredientId) {
                const ingredient = row.ingredient
                if (!ingredient?.isActive || !ingredient.costUnit?.isActive || ingredient.costUnit.unitType !== "weight"
                    || ingredient.costPerUnit == null || !toDecimal(ingredient.costUnit.baseFactor).isFinite() || toDecimal(ingredient.costUnit.baseFactor).lte(0)) throw new AppError(422, "errors.juice_invalid_recipe")
                return { spiceMaterialId: ingredient.id, displayName: pickTranslatedName(ingredient.displayName, ingredient.translations, language), gramsPerLiter: row.gramsPerLiter, costPerGram: toDecimal(ingredient.costPerUnit).div(ingredient.costUnit.baseFactor).toString() }
            }
            if (!allowLegacy) throw new AppError(422, "errors.juice_shared_ingredients_required")
            if (!row.spiceMaterialId || !row.spiceMaterial?.isActive) throw new AppError(422, "errors.juice_invalid_recipe")
            return { spiceMaterialId: row.spiceMaterialId, displayName: row.spiceMaterial.displayName, gramsPerLiter: row.gramsPerLiter, costPerGram: row.spiceMaterial.costPerGram }
        }),
    }
    return { recipe, ingredientRows: spices }
}
