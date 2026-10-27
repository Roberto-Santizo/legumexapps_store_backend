import sequelize from "../../../database/connection"
import Juice from "../models/Juice.model"
import Product from "../../product/models/Product.model"
import SubCategory from "../../category/models/SubCategory.model"
import Category from "../../category/models/Category.model"
import Client from "../../client/models/Client.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { generateUniqueSlug } from "../../../shared/utils/slug.util"
import type { Transaction } from "sequelize"

// Linking an existing juice creates its commercial identity, never a second recipe.
export async function linkJuiceProduct(juiceId: number, subCategoryId: number, existingTransaction?: Transaction) {
    const link = async (transaction: Transaction) => {
        const juice = await Juice.findOne({ where: { id: juiceId, isActive: true }, transaction, lock: transaction.LOCK.UPDATE })
        if (!juice) throw new NotFoundError("Juice", juiceId)
        if (juice.productId) throw new AppError(409, "errors.juice_already_linked")
        const sub = await SubCategory.findOne({ where: { id: subCategoryId, isActive: true }, include: [{ model: Category, as: "parentCategory", required: true, where: { isActive: true } }], transaction })
        if (!sub) throw new NotFoundError("SubCategory", subCategoryId)
        if (!await Client.findOne({ where: { id: juice.clientId, isActive: true }, transaction })) throw new NotFoundError("Client", juice.clientId)
        const urlSlug = await generateUniqueSlug(juice.displayName, async candidate => Boolean(await Product.findOne({ where: { urlSlug: candidate }, transaction })))
        const product = await Product.create({ subCategoryId, clientId: juice.clientId, displayName: juice.displayName, imageUrl: juice.imageUrl, urlSlug, isOrganic: false, additionalCostPerUnit: null }, { transaction })
        await juice.update({ productId: product.id }, { transaction })
        return { productId: product.id, juiceId: juice.id }
    }
    return existingTransaction ? link(existingTransaction) : sequelize.transaction(link)
}
