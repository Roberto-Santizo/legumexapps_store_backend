import { Op, WhereOptions } from "sequelize";
import ProductType from "../models/ProductType.model";
import {NotFoundError} from "../../../shared/errors/AppError";
import {CreateProductTypeInput, UpdateProductTypeInput} from "../schemas/productType.schema";
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util";


async function listProductTypes(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<ProductType>> {
    const where: WhereOptions = { isActive: true, ...(search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}) }
    return paginate(ProductType, { where, order: [["displayName", "DESC"]] }, pagination)
}

async function getProductTypeById(id: number): Promise<ProductType> {
    const productType = await ProductType.findOne({ where: { id, isActive: true } })
    if (!productType) throw new NotFoundError("ProductType", id)
    return productType
}

async function createProductType(input:CreateProductTypeInput): Promise<ProductType> {
    return ProductType.create(input)
}

async function updateProductType(id:number,input: UpdateProductTypeInput): Promise<ProductType> {
    const productType = await getProductTypeById(id)
    return productType.update(input)
}

async function deleteProductType(id:number): Promise<void> {
    const productType = await getProductTypeById(id)
    await productType.update({isActive: false})
}

export const productTypeService = {
    listProductTypes,
    getProductTypeById,
    createProductType,
    updateProductType,
    deleteProductType
}