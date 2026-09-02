import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import {
    CreateProductVariantPalletMaterialInput,
    UpdateProductVariantPalletMaterialInput
} from "../schemas/productVariantPalletMaterial.schema"

async function listProductVariantPalletMaterials(): Promise<ProductVariantPalletMaterial[]> {
    return ProductVariantPalletMaterial.findAll({ where: { isActive: true } })
}

async function getProductVariantPalletMaterialById(id: number): Promise<ProductVariantPalletMaterial> {
    const productVariantPalletMaterial = await ProductVariantPalletMaterial.findOne({ where: { id, isActive: true } })
    if (!productVariantPalletMaterial) throw new NotFoundError("ProductVariantPalletMaterial", id)
    return productVariantPalletMaterial
}

async function createProductVariantPalletMaterial(
    input: CreateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    return ProductVariantPalletMaterial.create(input)
}

async function updateProductVariantPalletMaterial(
    id: number,
    input: UpdateProductVariantPalletMaterialInput
): Promise<ProductVariantPalletMaterial> {
    const productVariantPalletMaterial = await getProductVariantPalletMaterialById(id)
    return productVariantPalletMaterial.update(input)
}

async function deleteProductVariantPalletMaterial(id: number): Promise<void> {
    const productVariantPalletMaterial = await getProductVariantPalletMaterialById(id)
    await productVariantPalletMaterial.update({ isActive: false })
}

export const productVariantPalletMaterialService = {
    listProductVariantPalletMaterials,
    getProductVariantPalletMaterialById,
    createProductVariantPalletMaterial,
    updateProductVariantPalletMaterial,
    deleteProductVariantPalletMaterial,
}
