import { Op, WhereOptions } from "sequelize"
import ProductVariant from "../models/ProductVariant.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CreateProductVariantInput, UpdateProductVariantInput } from "../schemas/productVariant.schema"

async function listProductVariants(): Promise<ProductVariant[]> {
    return ProductVariant.findAll({ where: { isActive: true }, order: [["id", "DESC"]] })
}

async function getProductVariantById(id: number): Promise<ProductVariant> {
    const productVariant = await ProductVariant.findOne({ where: { id, isActive: true } })
    if (!productVariant) throw new NotFoundError("ProductVariant", id)
    return productVariant
}

// Cada Producto solo puede tener un SKU por Presentación -- sin skuCode, esta ES la única regla
// de unicidad de una variante: (productId,
// presentationId) es su identidad completa, junto con Product.codigo como "cabeza" del SKU. Se
// enforce a nivel de aplicación, no con un índice de BD, a propósito: así no puede quedar
// bloqueado por filas preexistentes, mismo criterio que el resto de "assert*" de este archivo.
async function assertPresentationNotAlreadyUsed(productId: number, presentationId: number, excludeId?: number): Promise<void> {
    const where: WhereOptions = excludeId
        ? { productId, presentationId, id: { [Op.ne]: excludeId } }
        : { productId, presentationId }
    const existing = await ProductVariant.findOne({ where })
    if (existing) {
        throw new AppError(409, "errors.product_variant_presentation_already_used")
    }
}

// Opción B (decisión de negocio): la Presentación de un SKU queda fija una vez
// creada. Si se quiere cotizar el mismo producto en otra presentación, se crea un SKU nuevo --
// nunca se reasigna uno existente. No afecta cotizaciones ya guardadas (Quote congela su propio
// snapshot, ver quoteService.calculateQuote), solo bloquea la edición hacia adelante.
function assertPresentationNotChanged(existingPresentationId: number, incomingPresentationId: number): void {
    if (incomingPresentationId !== existingPresentationId) {
        throw new AppError(422, "errors.product_variant_presentation_immutable")
    }
}

async function createProductVariant(input: CreateProductVariantInput): Promise<ProductVariant> {
    await assertPresentationNotAlreadyUsed(input.productId, input.presentationId)
    return ProductVariant.create(input)
}

async function updateProductVariant(id: number, input: UpdateProductVariantInput): Promise<ProductVariant> {
    const productVariant = await getProductVariantById(id)

    // presentationId es requerido en updateProductVariantSchema, así que en la práctica siempre
    // llega -- el `if` es defensivo, por si algún caller llama al service directo sin pasar por
    // el schema HTTP.
    if (input.presentationId) assertPresentationNotChanged(productVariant.presentationId, input.presentationId)

    // productId SÍ puede cambiar en un update (no se recupera como requerido en el schema, y el
    // form del admin lo omite, pero la API no lo prohíbe) -- si eso pasa, el chequeo de
    // duplicado corre contra el Producto NUEVO. presentationId es siempre el ya guardado (recién
    // se confirmó arriba que no cambió), excluyendo esta misma fila de la búsqueda.
    const effectiveProductId = input.productId !== undefined ? input.productId : productVariant.productId
    await assertPresentationNotAlreadyUsed(effectiveProductId, productVariant.presentationId, id)

    return productVariant.update(input)
}

async function deleteProductVariant(id: number): Promise<void> {
    const productVariant = await getProductVariantById(id)
    await productVariant.update({ isActive: false })
}

export const productVariantService = {
    listProductVariants,
    getProductVariantById,
    createProductVariant,
    updateProductVariant,
    deleteProductVariant,
}
