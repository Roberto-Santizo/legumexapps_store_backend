import { Op, WhereOptions } from "sequelize"
import Presentation from "../models/Presentation.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { CreatePresentationInput, UpdatePresentationInput } from "../schemas/presentation.schema"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"

async function listPresentations(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Presentation>> {
    const where: WhereOptions = { isActive: true, ...(search ? { displayLabel: { [Op.iLike]: `%${search}%` } } : {}) }
    return paginate(Presentation, { where, order: [["displayLabel", "DESC"]] }, pagination)
}

async function getPresentationById(id: number): Promise<Presentation> {
    const presentation = await Presentation.findOne({ where: { id, isActive: true } })
    if (!presentation) throw new NotFoundError("Presentation", id)
    return presentation
}

async function createPresentation(input: CreatePresentationInput): Promise<Presentation> {
    return Presentation.create(input)
}

async function updatePresentation(id: number, input: UpdatePresentationInput): Promise<Presentation> {
    const presentation = await getPresentationById(id)
    return presentation.update(input)
}

async function deletePresentation(id: number): Promise<void> {
    const presentation = await getPresentationById(id)
    await presentation.update({ isActive: false })
}

export const presentationService = {
    listPresentations,
    getPresentationById,
    createPresentation,
    updatePresentation,
    deletePresentation,
}
