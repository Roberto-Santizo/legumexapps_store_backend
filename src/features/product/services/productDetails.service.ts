import Product from "../models/Product.model"
import ProductVariant from "../models/ProductVariant.model"
import ProductRawMaterial from "../models/ProductRawMaterial.model"
import ProductIngredient from "../models/ProductIngredient.model"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import ProductVariantIntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import Client from "../../client/models/Client.model"
import SubCategory from "../../category/models/SubCategory.model"
import Category from "../../category/models/Category.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import Packaging from "../../packaging/models/Packaging.model"
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model"
import Presentation from "../../presentation/models/Presentation.model"
import Unit from "../../unit/models/Unit.model"
import { NotFoundError } from "../../../shared/errors/AppError"

const unitInclude = { model: Unit, as: "costUnit", attributes: ["unitCode", "displayName"] }
const packagingAttributes = ["id", "displayName", "displayNameEn", "code", "isActive", "packagingRole", "unitCost"]

// Read-only administrative projection. Separate has-many loads batch each association
// across all variants, avoiding both N+1 requests and a Cartesian product of materials.
export async function getFixedProductDetails(id: number) {
    const product = await Product.findOne({
        where: { id },
        attributes: ["id", "displayName", "isActive", "isOrganic", "imageUrl", "additionalCostPerUnit"],
        include: [
            { model: Client, as: "client", attributes: ["id", "name", "isActive"] },
            { model: SubCategory, as: "parentSubCategory", attributes: ["id", "displayName"],
                include: [{ model: Category, as: "parentCategory", attributes: ["id", "displayName"] }] },
            { model: ProductRawMaterial, as: "productRawMaterials", separate: true,
                attributes: ["id", "productId", "percentage", "isActive"], order: [["displayOrder", "ASC"], ["id", "ASC"]],
                include: [{ model: RawMaterial, as: "usedRawMaterial",
                    attributes: ["id", "displayName", "code", "isActive", "ingredientType", "costPerUnit"], include: [unitInclude] }] },
            { model: ProductIngredient, as: "productIngredients", separate: true,
                attributes: ["id", "productId", "grams", "referenceNetWeightGrams", "isActive"], order: [["displayOrder", "ASC"], ["id", "ASC"]],
                include: [{ model: Ingredient, as: "usedIngredient", attributes: ["id", "displayName", "code", "isActive", "costPerUnit"], include: [unitInclude] }] },
            { model: ProductVariant, as: "productVariants", separate: true,
                attributes: ["id", "productId", "skuCode", "isActive", "boxesPerPallet", "bagsPerBox", "unitsPerIntermediatePackage"], order: [["id", "ASC"]],
                include: [
                    { model: Presentation, as: "sizePresentation", attributes: ["id", "displayLabel", "netWeightGrams", "isActive"] },
                    { model: ProductVariantUnitMaterial, as: "unitMaterials", separate: true, order: [["id", "ASC"]],
                        attributes: ["id", "productVariantId", "isActive", "quantityPerUnit", "optionGroup", "optionGroupId", "isDefault"],
                        include: [{ model: Packaging, as: "usedUnitMaterial", attributes: packagingAttributes },
                            { model: PackagingGroup, as: "optionGroupCatalog", attributes: ["id", "displayName"] }] },
                    { model: ProductVariantIntermediateMaterial, as: "intermediateMaterials", separate: true, order: [["id", "ASC"]],
                        attributes: ["id", "productVariantId", "isActive", "optionGroup", "isDefault"],
                        include: [{ model: Packaging, as: "usedIntermediateMaterial", attributes: packagingAttributes }] },
                    { model: ProductVariantPalletMaterial, as: "palletMaterials", separate: true, order: [["id", "ASC"]],
                        attributes: ["id", "productVariantId", "isActive", "quantityValue", "quantityBasis", "optionGroup", "optionGroupId", "isDefault"],
                        include: [{ model: Packaging, as: "usedPalletMaterial", attributes: packagingAttributes },
                            { model: PackagingGroup, as: "packagingGroup", attributes: ["id", "displayName"] }] },
                ] },
        ],
    })
    if (!product) throw new NotFoundError("Product", id)
    return product.toJSON()
}
