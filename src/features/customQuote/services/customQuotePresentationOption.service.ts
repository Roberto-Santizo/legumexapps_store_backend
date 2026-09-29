import CustomQuotePresentationOption from "../models/CustomQuotePresentationOption.model"
import Presentation from "../../presentation/models/Presentation.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import {
    CreateCustomQuotePresentationOptionInput,
    UpdateCustomQuotePresentationOptionInput
} from "../schemas/customQuoteConfig.schema"

export interface CustomQuotePresentationOptionDto {
    id: number
    presentationId: number
    presentationLabel: string | null
    netWeightGrams: number | null
    boxesPerPallet: number
    bagsPerBox: number
    unitsPerIntermediatePackage: number | null
    isActive: boolean
}

const OPTION_INCLUDE = [{ model: Presentation, as: "presentation", attributes: ["id", "displayLabel", "netWeightGrams"] }]

function toDto(option: CustomQuotePresentationOption): CustomQuotePresentationOptionDto {
    const netWeightGrams = option.presentation?.netWeightGrams
    return {
        id: option.id,
        presentationId: option.presentationId,
        presentationLabel: option.presentation?.displayLabel ?? null,
        // DECIMAL -> string en pg: cast en el borde del DTO (§8).
        netWeightGrams: netWeightGrams === null || netWeightGrams === undefined ? null : Number(netWeightGrams),
        boxesPerPallet: option.boxesPerPallet,
        bagsPerBox: option.bagsPerBox,
        unitsPerIntermediatePackage: option.unitsPerIntermediatePackage ?? null,
        isActive: option.isActive,
    }
}

// Solo se puede ofrecer una presentación activa CON peso neto: todo el costeo a la medida (materia
// prima, ingredientes, costos por peso) se calcula sobre él.
async function assertPresentationIsQuotable(presentationId: number): Promise<void> {
    const presentation = await Presentation.findOne({ where: { id: presentationId, isActive: true } })
    if (!presentation) throw new NotFoundError("Presentation", presentationId)
    if (!(Number(presentation.netWeightGrams) > 0)) {
        throw new AppError(422, "errors.custom_quote_presentation_missing_net_weight")
    }
}

async function listPresentationOptions(): Promise<CustomQuotePresentationOptionDto[]> {
    const options = await CustomQuotePresentationOption.findAll({
        include: OPTION_INCLUDE,
        order: [["isActive", "DESC"], ["id", "ASC"]],
    })
    return options.map(toDto)
}

async function findActiveOption(id: number): Promise<CustomQuotePresentationOption> {
    const option = await CustomQuotePresentationOption.findOne({ where: { id, isActive: true }, include: OPTION_INCLUDE })
    if (!option) throw new NotFoundError("CustomQuotePresentationOption", id)
    return option
}

async function getPresentationOptionById(id: number): Promise<CustomQuotePresentationOptionDto> {
    return toDto(await findActiveOption(id))
}

async function createPresentationOption(input: CreateCustomQuotePresentationOptionInput): Promise<CustomQuotePresentationOption> {
    await assertPresentationIsQuotable(input.presentationId)

    const existing = await CustomQuotePresentationOption.findOne({ where: { presentationId: input.presentationId } })
    if (existing) throw new AppError(409, "errors.custom_quote_option_already_exists")

    return CustomQuotePresentationOption.create(input)
}

async function updatePresentationOption(
    id: number,
    input: UpdateCustomQuotePresentationOptionInput
): Promise<CustomQuotePresentationOption> {
    const option = await findActiveOption(id)
    return option.update({
        boxesPerPallet: input.boxesPerPallet,
        bagsPerBox: input.bagsPerBox,
        unitsPerIntermediatePackage: input.unitsPerIntermediatePackage,
    })
}

async function setPresentationOptionStatus(id: number, isActive: boolean): Promise<CustomQuotePresentationOption> {
    const option = await CustomQuotePresentationOption.findOne({ where: { id } })
    if (!option) throw new NotFoundError("CustomQuotePresentationOption", id)
    if (isActive) await assertPresentationIsQuotable(option.presentationId)
    return option.update({ isActive })
}

export const customQuotePresentationOptionService = {
    listPresentationOptions,
    getPresentationOptionById,
    createPresentationOption,
    updatePresentationOption,
    setPresentationOptionStatus,
}
