import CustomQuoteRawMaterialOption from "../models/CustomQuoteRawMaterialOption.model"
import SubCategory from "../../category/models/SubCategory.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import {
    CreateCustomQuoteRawMaterialOptionInput,
    UpdateCustomQuoteRawMaterialOptionInput
} from "../schemas/customQuoteConfig.schema"

export interface CustomQuoteRawMaterialOptionDto {
    id: number
    subCategoryId: number
    subCategoryName: string | null
    rawMaterialId: number
    rawMaterialCode: string | null
    rawMaterialName: string | null
    isMixable: boolean | null
    isOrganic: boolean | null
    minPercentage: number | null
    maxPercentage: number | null
    isActive: boolean
}

const OPTION_INCLUDE = [
    { model: SubCategory, as: "subCategory", attributes: ["id", "displayName"] },
    { model: RawMaterial, as: "usedRawMaterial", attributes: ["id", "code", "displayName", "isMixable", "isOrganic"] },
]

// DECIMAL llega como string desde pg: se castea acá, en el borde del DTO (§8).
function toNullableNumber(value: number | string | null | undefined): number | null {
    return value === null || value === undefined ? null : Number(value)
}

function toDto(option: CustomQuoteRawMaterialOption): CustomQuoteRawMaterialOptionDto {
    return {
        id: option.id,
        subCategoryId: option.subCategoryId,
        subCategoryName: option.subCategory?.displayName ?? null,
        rawMaterialId: option.rawMaterialId,
        rawMaterialCode: option.usedRawMaterial?.code ?? null,
        rawMaterialName: option.usedRawMaterial?.displayName ?? null,
        isMixable: option.usedRawMaterial?.isMixable ?? null,
        isOrganic: option.usedRawMaterial?.isOrganic ?? null,
        minPercentage: toNullableNumber(option.minPercentage),
        maxPercentage: toNullableNumber(option.maxPercentage),
        isActive: option.isActive,
    }
}

async function assertSubCategoryIsActive(subCategoryId: number): Promise<void> {
    const subCategory = await SubCategory.findOne({ where: { id: subCategoryId, isActive: true } })
    if (!subCategory) throw new NotFoundError("SubCategory", subCategoryId)
}

async function assertRawMaterialIsActive(rawMaterialId: number): Promise<void> {
    const rawMaterial = await RawMaterial.findOne({ where: { id: rawMaterialId, isActive: true } })
    if (!rawMaterial) throw new NotFoundError("RawMaterial", rawMaterialId)
}

function assertMinNotGreaterThanMax(minPercentage: number | null, maxPercentage: number | null): void {
    if (minPercentage !== null && maxPercentage !== null && minPercentage > maxPercentage) {
        throw new AppError(422, "errors.custom_quote_min_greater_than_max", { minPercentage, maxPercentage })
    }
}

async function listRawMaterialOptions(subCategoryId?: number): Promise<CustomQuoteRawMaterialOptionDto[]> {
    const options = await CustomQuoteRawMaterialOption.findAll({
        where: subCategoryId ? { subCategoryId } : {},
        include: OPTION_INCLUDE,
        order: [["isActive", "DESC"], ["subCategoryId", "ASC"], ["id", "ASC"]],
    })
    return options.map(toDto)
}

async function findActiveOption(id: number): Promise<CustomQuoteRawMaterialOption> {
    const option = await CustomQuoteRawMaterialOption.findOne({ where: { id, isActive: true }, include: OPTION_INCLUDE })
    if (!option) throw new NotFoundError("CustomQuoteRawMaterialOption", id)
    return option
}

async function getRawMaterialOptionById(id: number): Promise<CustomQuoteRawMaterialOptionDto> {
    return toDto(await findActiveOption(id))
}

// Una fila por (subcategoría, materia prima), activa o no: si ya existe desactivada se reactiva, no
// se duplica (el índice único lo impediría igual, con un error genérico).
async function createRawMaterialOption(input: CreateCustomQuoteRawMaterialOptionInput): Promise<CustomQuoteRawMaterialOption> {
    await assertSubCategoryIsActive(input.subCategoryId)
    await assertRawMaterialIsActive(input.rawMaterialId)
    assertMinNotGreaterThanMax(input.minPercentage, input.maxPercentage)

    const existing = await CustomQuoteRawMaterialOption.findOne({
        where: { subCategoryId: input.subCategoryId, rawMaterialId: input.rawMaterialId }
    })
    if (existing) throw new AppError(409, "errors.custom_quote_option_already_exists")

    return CustomQuoteRawMaterialOption.create(input)
}

async function updateRawMaterialOption(
    id: number,
    input: UpdateCustomQuoteRawMaterialOptionInput
): Promise<CustomQuoteRawMaterialOption> {
    const option = await findActiveOption(id)
    assertMinNotGreaterThanMax(input.minPercentage, input.maxPercentage)
    return option.update({ minPercentage: input.minPercentage, maxPercentage: input.maxPercentage })
}

// Reactivar exige que la subcategoría y la materia prima sigan activas (una opción no puede
// ofrecer algo que el catálogo ya retiró).
async function setRawMaterialOptionStatus(id: number, isActive: boolean): Promise<CustomQuoteRawMaterialOption> {
    const option = await CustomQuoteRawMaterialOption.findOne({ where: { id } })
    if (!option) throw new NotFoundError("CustomQuoteRawMaterialOption", id)
    if (isActive) {
        await assertSubCategoryIsActive(option.subCategoryId)
        await assertRawMaterialIsActive(option.rawMaterialId)
    }
    return option.update({ isActive })
}

export const customQuoteRawMaterialOptionService = {
    listRawMaterialOptions,
    getRawMaterialOptionById,
    createRawMaterialOption,
    updateRawMaterialOption,
    setRawMaterialOptionStatus,
}
