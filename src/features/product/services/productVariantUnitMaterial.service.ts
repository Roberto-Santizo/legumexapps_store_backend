import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { packagingService } from "../../packaging/services/packaging.service"
import {
    CreateProductVariantUnitMaterialInput,
    UpdateProductVariantUnitMaterialInput
} from "../schemas/productVariantUnitMaterial.schema"

async function listProductVariantUnitMaterials(): Promise<ProductVariantUnitMaterial[]> {
    return ProductVariantUnitMaterial.findAll({ where: { isActive: true } })
}

async function getProductVariantUnitMaterialById(id: number): Promise<ProductVariantUnitMaterial> {
    const productVariantUnitMaterial = await ProductVariantUnitMaterial.findOne({ where: { id, isActive: true } })
    if (!productVariantUnitMaterial) throw new NotFoundError("ProductVariantUnitMaterial", id)
    return productVariantUnitMaterial
}

async function createProductVariantUnitMaterial(
    input: CreateProductVariantUnitMaterialInput
): Promise<ProductVariantUnitMaterial> {
    await packagingService.assertPackagingHasRole(input.packagingId, "unit")
    return ProductVariantUnitMaterial.create(input)
}

async function updateProductVariantUnitMaterial(
    id: number,
    input: UpdateProductVariantUnitMaterialInput
): Promise<ProductVariantUnitMaterial> {
    const productVariantUnitMaterial = await getProductVariantUnitMaterialById(id)
    if (input.packagingId) await packagingService.assertPackagingHasRole(input.packagingId, "unit")
    return productVariantUnitMaterial.update(input)
}

async function deleteProductVariantUnitMaterial(id: number): Promise<void> {
    const productVariantUnitMaterial = await getProductVariantUnitMaterialById(id)
    await productVariantUnitMaterial.update({ isActive: false })
}

export const productVariantUnitMaterialService = {
    listProductVariantUnitMaterials,
    getProductVariantUnitMaterialById,
    createProductVariantUnitMaterial,
    updateProductVariantUnitMaterial,
    deleteProductVariantUnitMaterial,
}
