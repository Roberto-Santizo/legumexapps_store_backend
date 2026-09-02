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

function assertIntermediatePackagingConsistency(
    intermediatePackagingId: number | null | undefined,
    unitsPerIntermediatePackage: number | null | undefined
): void {
    const hasPackaging = intermediatePackagingId !== null && intermediatePackagingId !== undefined
    const hasUnits = unitsPerIntermediatePackage !== null && unitsPerIntermediatePackage !== undefined
    if (hasPackaging !== hasUnits) {
        throw new AppError(422, "errors.intermediate_packaging_requires_units")
    }
}

async function createProductVariant(input: CreateProductVariantInput): Promise<ProductVariant> {
    assertIntermediatePackagingConsistency(input.intermediatePackagingId, input.unitsPerIntermediatePackage)
    return ProductVariant.create(input)
}

async function updateProductVariant(id: number, input: UpdateProductVariantInput): Promise<ProductVariant> {
    const productVariant = await getProductVariantById(id)

    const effectiveIntermediatePackagingId = input.intermediatePackagingId !== undefined
        ? input.intermediatePackagingId
        : productVariant.intermediatePackagingId
    const effectiveUnitsPerIntermediatePackage = input.unitsPerIntermediatePackage !== undefined
        ? input.unitsPerIntermediatePackage
        : productVariant.unitsPerIntermediatePackage
    assertIntermediatePackagingConsistency(effectiveIntermediatePackagingId, effectiveUnitsPerIntermediatePackage)
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
