import CustomQuoteIngredientOption from "../models/CustomQuoteIngredientOption.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import {
    CreateCustomQuoteIngredientOptionInput,
    UpdateCustomQuoteIngredientOptionInput
} from "../schemas/customQuoteConfig.schema"

export interface CustomQuoteIngredientOptionDto {
    id: number
    ingredientId: number
    ingredientCode: string | null
    ingredientName: string | null
    maxGramsPerKg: number | null
    isActive: boolean
}

const OPTION_INCLUDE = [{ model: Ingredient, as: "usedIngredient", attributes: ["id", "code", "displayName"] }]

function toDto(option: CustomQuoteIngredientOption): CustomQuoteIngredientOptionDto {
    return {
        id: option.id,
        ingredientId: option.ingredientId,
        ingredientCode: option.usedIngredient?.code ?? null,
        ingredientName: option.usedIngredient?.displayName ?? null,
        // DECIMAL -> string en pg: cast en el borde del DTO (§8).
        maxGramsPerKg: option.maxGramsPerKg === null || option.maxGramsPerKg === undefined ? null : Number(option.maxGramsPerKg),
        isActive: option.isActive,
    }
}

async function assertIngredientIsActive(ingredientId: number): Promise<void> {
    const ingredient = await Ingredient.findOne({ where: { id: ingredientId, isActive: true } })
    if (!ingredient) throw new NotFoundError("Ingredient", ingredientId)
}

async function listIngredientOptions(): Promise<CustomQuoteIngredientOptionDto[]> {
    const options = await CustomQuoteIngredientOption.findAll({
        include: OPTION_INCLUDE,
        order: [["isActive", "DESC"], ["id", "ASC"]],
    })
    return options.map(toDto)
}

async function findActiveOption(id: number): Promise<CustomQuoteIngredientOption> {
    const option = await CustomQuoteIngredientOption.findOne({ where: { id, isActive: true }, include: OPTION_INCLUDE })
    if (!option) throw new NotFoundError("CustomQuoteIngredientOption", id)
    return option
}

async function getIngredientOptionById(id: number): Promise<CustomQuoteIngredientOptionDto> {
    return toDto(await findActiveOption(id))
}

async function createIngredientOption(input: CreateCustomQuoteIngredientOptionInput): Promise<CustomQuoteIngredientOption> {
    await assertIngredientIsActive(input.ingredientId)

    const existing = await CustomQuoteIngredientOption.findOne({ where: { ingredientId: input.ingredientId } })
    if (existing) throw new AppError(409, "errors.custom_quote_option_already_exists")

    return CustomQuoteIngredientOption.create(input)
}

async function updateIngredientOption(
    id: number,
    input: UpdateCustomQuoteIngredientOptionInput
): Promise<CustomQuoteIngredientOption> {
    const option = await findActiveOption(id)
    return option.update({ maxGramsPerKg: input.maxGramsPerKg })
}

async function setIngredientOptionStatus(id: number, isActive: boolean): Promise<CustomQuoteIngredientOption> {
    const option = await CustomQuoteIngredientOption.findOne({ where: { id } })
    if (!option) throw new NotFoundError("CustomQuoteIngredientOption", id)
    if (isActive) await assertIngredientIsActive(option.ingredientId)
    return option.update({ isActive })
}

export const customQuoteIngredientOptionService = {
    listIngredientOptions,
    getIngredientOptionById,
    createIngredientOption,
    updateIngredientOption,
    setIngredientOptionStatus,
}
