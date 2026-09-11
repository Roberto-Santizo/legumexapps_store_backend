import { Op, WhereOptions } from "sequelize"
import ProcessingCost from "../models/ProcessingCost.model"
import ProcessingCostTranslation from "../models/ProcessingCostTranslation.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { CreateProcessingCostInput, UpdateProcessingCostInput, ProcessingCostTranslationInput } from "../schemas/processingCost.schema"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"

async function listProcessingCosts(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<ProcessingCost>> {
    const where: WhereOptions = { isActive: true, ...(search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}) }
    return paginate(
        ProcessingCost,
        { where, order: [["displayName", "DESC"]], include: [{ model: ProcessingCostTranslation, as: "translations" }] },
        pagination
    )
}

async function getProcessingCostById(id: number): Promise<ProcessingCost> {
    const processingCost = await ProcessingCost.findOne({
        where: { id, isActive: true },
        include: [{ model: ProcessingCostTranslation, as: "translations" }]
    })
    if (!processingCost) throw new NotFoundError("ProcessingCost", id)
    return processingCost
}

// Mismo patrón que ingredient.service.ts::syncEnglishTranslation -- el español vive siempre en
// displayName, la tabla *Translation solo guarda overrides para idiomas adicionales.
async function syncEnglishTranslation(processingCostId: number, en: ProcessingCostTranslationInput | undefined): Promise<void> {
    if (!en?.displayName) return
    const [translation] = await ProcessingCostTranslation.findOrCreate({
        where: { processingCostId, language: "en" },
        defaults: { processingCostId, language: "en", displayName: en.displayName }
    })
    await translation.update({ displayName: en.displayName })
}

async function createProcessingCost(input: CreateProcessingCostInput): Promise<ProcessingCost> {
    const { translations, ...rest } = input
    const processingCost = await ProcessingCost.create(rest)
    await syncEnglishTranslation(processingCost.id, translations?.en)
    return getProcessingCostById(processingCost.id)
}

async function updateProcessingCost(id: number, input: UpdateProcessingCostInput): Promise<ProcessingCost> {
    const processingCost = await getProcessingCostById(id)
    const { translations, ...rest } = input
    await processingCost.update(rest)
    await syncEnglishTranslation(id, translations?.en)
    return getProcessingCostById(id)
}

async function deleteProcessingCost(id: number): Promise<void> {
    const processingCost = await getProcessingCostById(id)
    await processingCost.update({ isActive: false })
}

export const processingCostService = {
    listProcessingCosts,
    getProcessingCostById,
    createProcessingCost,
    updateProcessingCost,
    deleteProcessingCost,
}
