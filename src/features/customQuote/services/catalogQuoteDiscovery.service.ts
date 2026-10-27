import { loadGenericProfiles } from "../../genericPackaging/services/genericPackaging.service"
import { genericConfigurationOption } from "../../genericPackaging/services/genericQuoteAdapter"
import Juice from "../../juice/models/Juice.model"
import type { Transaction } from "sequelize"
import Product from "../../product/models/Product.model"
import ProductRawMaterial from "../../product/models/ProductRawMaterial.model"
import Category from "../../category/models/Category.model"
import CategoryTranslation from "../../category/models/CategoryTranslation.model"
import SubCategory from "../../category/models/SubCategory.model"
import SubCategoryTranslation from "../../category/models/SubCategoryTranslation.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../../rawMaterial/models/RawMaterialTranslation.model"
import Unit from "../../unit/models/Unit.model"
import { ContentLanguage, pickTranslatedName } from "../../../shared/utils/translation.util"
import { loadPalletKit, palletKitOptions } from "../../palletKit/services/palletKit.service"

const QUOTABLE_TYPES = ["fruit", "vegetable", "pulp", "other"]

export type CompositionMode = "single" | "blend"
export type SubCategoryAvailability = "ready" | "missing_recipe" | "missing_raw_materials" | "missing_pallet_kit" | "missing_configuration"

export async function loadCatalogContext(transaction?: Transaction) {
    const subCategories = await SubCategory.findAll({ transaction, where: { isActive: true }, include: [
        { model: SubCategoryTranslation, as: "translations" },
        { model: Category, as: "parentCategory", required: true, where: { isActive: true }, include: [{ model: CategoryTranslation, as: "translations" }] },
    ] })
    const products = await Product.findAll({ transaction, where: { isActive: true }, include: [{
        model: ProductRawMaterial, as: "productRawMaterials", required: false, where: { isActive: true }, include: [{
            model: RawMaterial, as: "usedRawMaterial", include: [{ model: Unit, as: "costUnit" }, { model: RawMaterialTranslation, as: "translations" }],
        }],
    }] })
    const rawMaterials = await RawMaterial.findAll({ transaction, where: { isActive: true }, include: [{ model: Unit, as: "costUnit" }, { model: RawMaterialTranslation, as: "translations" }] })
    const linked = new Set((await Juice.findAll({ transaction, attributes: ["productId"] })).map(row => row.productId).filter(Boolean))
    return { subCategories, products: products.filter(product => !linked.has(product.id)), rawMaterials }
}

// Type and mode come only from the recipes of the subcategory's fixed products: one distinct raw
// material in every recipe = single, two or more in any recipe = blend. No recipes = no classification.
export function subCategoryComposition(products: Product[], subCategoryId: number): { mode: CompositionMode; types: string[] } | null {
    const recipes = products.filter(product => product.isActive && product.subCategoryId === subCategoryId)
        .map(product => (product.productRawMaterials ?? []).filter(row => row.isActive && row.usedRawMaterial))
        .filter(rows => rows.length > 0)
    const types = [...new Set(recipes.flatMap(rows => rows.map(row => row.usedRawMaterial.ingredientType)))].filter(type => QUOTABLE_TYPES.includes(type)).sort()
    if (!recipes.length || !types.length) return null
    const blend = recipes.some(rows => new Set(rows.map(row => row.rawMaterialId)).size >= 2)
    return { mode: blend ? "blend" : "single", types }
}

// Eligible list = active catalog raw materials of the subcategory's types with a usable cost per weight.
export function eligibleRawMaterials(rawMaterials: RawMaterial[], types: string[]): RawMaterial[] {
    return rawMaterials.filter(raw => raw.isActive && types.includes(raw.ingredientType)
        && raw.costPerUnit != null && Number.isFinite(Number(raw.costPerUnit)) && Number(raw.costPerUnit) >= 0
        && raw.costUnit?.isActive && raw.costUnit.unitType === "weight" && Number.isFinite(Number(raw.costUnit.baseFactor)) && Number(raw.costUnit.baseFactor) > 0)
        .sort((a, b) => a.id - b.id)
}

export async function discoverCatalog(language: ContentLanguage) {
    const { subCategories, products, rawMaterials: catalogRawMaterials } = await loadCatalogContext()
    const profiles = await loadGenericProfiles()
    const kit = await loadPalletKit()
    const kitReady = kit.every(part => part.options.length > 0)
    type DiscoveredSubCategory = { id: number; displayName: string; imageUrl: string | null; availability: SubCategoryAvailability; compositionMode: CompositionMode | null; rawMaterials: { rawMaterialId: number; displayName: string; ingredientType: string }[]; configurations: ReturnType<typeof genericConfigurationOption>[] }
    // Same category/subcategory images that fixed products show in their quote wizard.
    const categories = new Map<number, { id: number; displayName: string; imageUrl: string | null; subCategories: DiscoveredSubCategory[] }>()
    for (const subCategory of subCategories) {
        const composition = subCategoryComposition(products, subCategory.id)
        const rawMaterials = composition ? eligibleRawMaterials(catalogRawMaterials, composition.types) : []
        // The representative only receives configurations that can be quoted right now.
        const configurations = profiles.filter(profile => profile.isActive && profile.categoryId === subCategory.categoryId && profile.presentation?.isActive)
            .map(profile => genericConfigurationOption(profile)).filter(option => !option.configurationIssue)
        let availability: SubCategoryAvailability = "ready"
        if (!composition) availability = "missing_recipe"
        else if (!rawMaterials.length) availability = "missing_raw_materials"
        else if (!kitReady) availability = "missing_pallet_kit"
        else if (!configurations.length) availability = "missing_configuration"
        const parent = subCategory.parentCategory
        const category = categories.get(parent.id) ?? { id: parent.id, displayName: pickTranslatedName(parent.displayName, parent.translations, language), imageUrl: parent.imageUrl ?? null, subCategories: [] as DiscoveredSubCategory[] }
        category.subCategories.push({ id: subCategory.id, displayName: pickTranslatedName(subCategory.displayName, subCategory.translations, language), imageUrl: subCategory.imageUrl ?? null, availability, compositionMode: composition?.mode ?? null,
            rawMaterials: rawMaterials.map(raw => ({ rawMaterialId: raw.id, displayName: pickTranslatedName(raw.displayName, raw.translations, language), ingredientType: raw.ingredientType })),
            configurations: availability === "ready" ? configurations : [] })
        categories.set(parent.id, category)
    }
    const palletKit = palletKitOptions(kit, language)
    return { categories: [...categories.values()], palletKit }
}
