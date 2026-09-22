import { Op, WhereOptions } from "sequelize"
import Product from "../models/Product.model"
import ProductTranslation from "../models/ProductTranslation.model"
import Client from "../../client/models/Client.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CreateProductInput, UpdateProductInput, ProductTranslationInput } from "../schemas/product.schema"
import { generateUniqueSlug } from "../../../shared/utils/slug.util"
import { resolveCatalogImage } from "../../../shared/utils/catalogImage.util"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"

const IMAGE_FOLDER = "products"

// Incluido en todo lugar donde se lee/devuelve un Product (get/list/status) -- así el form de
// edición puede preseleccionar el Cliente actual y cualquier listado/detalle puede mostrar su
// nombre sin un segundo round-trip. attributes acotado a lo que realmente se necesita, mismo
// criterio que quotingSalesperson en quote.service.ts.
const CLIENT_INCLUDE = { model: Client, as: "client" as const, attributes: ["id", "name"] }

async function findActiveProduct(id: number): Promise<Product> {
    const product = await Product.findOne({
        where: { id, isActive: true },
        include: [{ model: ProductTranslation, as: "translations" }, CLIENT_INCLUDE]
    })
    if (!product) throw new NotFoundError("Product", id)
    return product
}

async function listProducts(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Product>> {
    const where: WhereOptions = search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}
    return paginate(
        Product,
        {
            where,
            order: [["isActive", "DESC"], ["displayName", "ASC"]],
            include: [{ model: ProductTranslation, as: "translations" }, CLIENT_INCLUDE]
        },
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

// Case-insensitive (Op.iLike) a propósito -- a diferencia de Packaging.code/Ingredient.code
// (cuyo chequeo de negocio es exacto), acá el usuario pidió explícitamente que "MP-001" y
// "mp-001" cuenten como el mismo código. El índice físico (products_codigo_unique, ver
// Product.model.ts) sigue siendo case-sensitive -- queda como defensa en profundidad para la
// ventana de carrera entre este chequeo y el INSERT/UPDATE real, no como la regla de negocio.
async function assertCodigoIsUnique(codigo: string, excludeId?: number): Promise<void> {
    const where: WhereOptions = excludeId
        ? { codigo: { [Op.iLike]: codigo }, id: { [Op.ne]: excludeId } }
        : { codigo: { [Op.iLike]: codigo } }
    const existing = await Product.findOne({ where })
    if (existing) throw new AppError(409, "errors.product_codigo_already_exists", { codigo })
}

// Mismo criterio que resolveQuoteDestination en quote.service.ts: un clientId que no resuelve a
// un Client real y activo se trata como "no encontrado", no como un 422 aparte -- un Cliente
// desactivado tampoco es una referencia válida para un Producto nuevo/editado.
async function assertClientExists(clientId: number): Promise<void> {
    const client = await Client.findOne({ where: { id: clientId, isActive: true } })
    if (!client) throw new NotFoundError("Client", clientId)
}

async function createProduct(input: CreateProductInput): Promise<Product> {
    const { image, translations, ...rest } = input
    await assertCodigoIsUnique(rest.codigo)
    await assertClientExists(rest.clientId)
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
    if (rest.codigo) await assertCodigoIsUnique(rest.codigo, id)
    if (rest.clientId) await assertClientExists(rest.clientId)
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
        include: [{ model: ProductTranslation, as: "translations" }, CLIENT_INCLUDE]
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
