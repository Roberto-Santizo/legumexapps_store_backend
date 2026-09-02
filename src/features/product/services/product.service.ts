import { Op, WhereOptions } from "sequelize"
import Product from "../models/Product.model"
import ProductTranslation from "../models/ProductTranslation.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { CreateProductInput, UpdateProductInput, ProductTranslationInput } from "../schemas/product.schema"
import { generateUniqueSlug } from "../../../shared/utils/slug.util"
import { resolveCatalogImage } from "../../../shared/utils/catalogImage.util"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"

const IMAGE_FOLDER = "products"

async function findActiveProduct(id: number): Promise<Product> {
    const product = await Product.findOne({
        where: { id, isActive: true },
        include: [{ model: ProductTranslation, as: "translations" }]
    })
    if (!product) throw new NotFoundError("Product", id)
    return product
}

async function listProducts(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Product>> {
    const where: WhereOptions = search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}
    return paginate(
        Product,
        { where, order: [["isActive", "DESC"], ["displayName", "ASC"]], include: [{ model: ProductTranslation, as: "translations" }] },
        pagination
    )
}

async function getProductById(id: number): Promise<Product> {
    return findActiveProduct(id)
}


async function syncEnglishTranslation(productId: number, en: ProductTranslationInput | undefined): Promise<void> {
    if (!en?.displayName) return
    const [translation] = await ProductTranslation.findOrCreate({
        where: { productId, language: "en" },
        defaults: { productId, language: "en", displayName: en.displayName }
    })
    await translation.update({ displayName: en.displayName })
}

async function createProduct(input: CreateProductInput): Promise<Product> {
    const { image, translations, ...rest } = input
    const urlSlug = await generateUniqueSlug(rest.displayName, async (candidate) => {
        const existing = await Product.findOne({ where: { urlSlug: candidate } })
        return !!existing
    })
    const imageUrl = await resolveCatalogImage(null, image, IMAGE_FOLDER)
    const product = await Product.create({ ...rest, urlSlug, imageUrl: imageUrl ?? null })
    await syncEnglishTranslation(product.id, translations?.en)
    return findActiveProduct(product.id)
}

async function updateProduct(id: number, input: UpdateProductInput): Promise<Product> {
    const product = await findActiveProduct(id)
    const { image, translations, ...rest } = input
    const imageUrl = await resolveCatalogImage(product.imageUrl, image, IMAGE_FOLDER)
    await product.update({ ...rest, ...(imageUrl !== undefined ? { imageUrl } : {}) })
    await syncEnglishTranslation(id, translations?.en)
    return findActiveProduct(id)
}

async function deleteProduct(id: number): Promise<void> {
    const product = await findActiveProduct(id)
    await product.update({ isActive: false })
}


async function setProductStatus(id: number, isActive: boolean): Promise<Product> {
    const product = await Product.findOne({
        where: { id },
        include: [{ model: ProductTranslation, as: "translations" }]
    })
    if (!product) throw new NotFoundError("Product", id)
    await product.update({ isActive })
    return product
}

export const productService = {
    listProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    setProductStatus,
}
