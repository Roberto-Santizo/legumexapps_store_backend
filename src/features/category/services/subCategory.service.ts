import { Op, WhereOptions } from "sequelize"
import SubCategory from "../models/SubCategory.model"
import SubCategoryTranslation from "../models/SubCategoryTranslation.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { CreateSubCategoryInput, UpdateSubCategoryInput, SubCategoryTranslationInput } from "../schemas/subCategory.schema"
import { generateUniqueSlug } from "../../../shared/utils/slug.util"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"


async function listSubCategories(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<SubCategory>> {
    const where: WhereOptions = search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}
    return paginate(
        SubCategory,
        { where, order: [["isActive", "DESC"], ["displayName", "ASC"]], include: [{ model: SubCategoryTranslation, as: "translations" }] },
        pagination
    )
}

async function getSubCategoryById(id: number): Promise<SubCategory> {
    const subCategory = await SubCategory.findOne({
        where: { id, isActive: true },
        include: [{ model: SubCategoryTranslation, as: "translations" }]
    })
    if (!subCategory) throw new NotFoundError("SubCategory", id)
    return subCategory
}

async function syncEnglishTranslation(subCategoryId: number, en: SubCategoryTranslationInput | undefined): Promise<void> {
    if (!en?.displayName) return
    const [translation] = await SubCategoryTranslation.findOrCreate({
        where: { subCategoryId, language: "en" },
        defaults: { subCategoryId, language: "en", displayName: en.displayName, fullDescription: en.fullDescription ?? null }
    })
    await translation.update({
        displayName: en.displayName,
        ...(en.fullDescription !== undefined ? { fullDescription: en.fullDescription } : {})
    })
}

async function createSubCategory(input: CreateSubCategoryInput): Promise<SubCategory> {
    const { translations, ...rest } = input
    const urlSlug = await generateUniqueSlug(rest.displayName, async (candidate) => {
        const existing = await SubCategory.findOne({
            where: { categoryId: rest.categoryId, urlSlug: candidate },
        })
        return !!existing
    })
    const subCategory = await SubCategory.create({ ...rest, urlSlug })
    await syncEnglishTranslation(subCategory.id, translations?.en)
    return getSubCategoryById(subCategory.id)
}

async function updateSubCategory(id: number, input: UpdateSubCategoryInput): Promise<SubCategory> {
    const subCategory = await getSubCategoryById(id)
    const { translations, ...rest } = input
    await subCategory.update(rest)
    await syncEnglishTranslation(id, translations?.en)
    return getSubCategoryById(id)
}

async function deleteSubCategory(id: number): Promise<void> {
    const subCategory = await getSubCategoryById(id)
    await subCategory.update({ isActive: false })
}


async function setSubCategoryStatus(id: number, isActive: boolean): Promise<SubCategory> {
    const subCategory = await SubCategory.findOne({
        where: { id },
        include: [{ model: SubCategoryTranslation, as: "translations" }]
    })
    if (!subCategory) throw new NotFoundError("SubCategory", id)
    await subCategory.update({ isActive })
    return subCategory
}

export const subCategoryService = {
    listSubCategories,
    getSubCategoryById,
    createSubCategory,
    updateSubCategory,
    deleteSubCategory,
    setSubCategoryStatus,
}
