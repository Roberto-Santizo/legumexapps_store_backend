import type { Transaction } from "sequelize"
import Product from "../../product/models/Product.model"
import ProductVariant from "../../product/models/ProductVariant.model"
import ProductRawMaterial from "../../product/models/ProductRawMaterial.model"
import ProductVariantUnitMaterial from "../../product/models/ProductVariantUnitMaterial.model"
import ProductVariantIntermediateMaterial from "../../product/models/ProductVariantIntermediateMaterial.model"
import ProductVariantPalletMaterial from "../../product/models/ProductVariantPalletMaterial.model"
import Category from "../../category/models/Category.model"
import CategoryTranslation from "../../category/models/CategoryTranslation.model"
import SubCategory from "../../category/models/SubCategory.model"
import SubCategoryTranslation from "../../category/models/SubCategoryTranslation.model"
import Presentation from "../../presentation/models/Presentation.model"
import Packaging from "../../packaging/models/Packaging.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../../rawMaterial/models/RawMaterialTranslation.model"
import Unit from "../../unit/models/Unit.model"
import { bucketMaterialsByGroup } from "../../quote/services/quoteMaterialSelection"
import { ContentLanguage, pickTranslatedName } from "../../../shared/utils/translation.util"
import { configurationIdentity, digest, validConfiguration } from "./catalogQuoteIdentity"

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
    const variants = await ProductVariant.findAll({ transaction, where: { isActive: true }, include: [
        { model: Product, as: "parentProduct", required: true, where: { isActive: true } },
        { model: Presentation, as: "sizePresentation" },
        { model: ProductVariantUnitMaterial, as: "unitMaterials", required: false, where: { isActive: true }, include: [{ model: Packaging, as: "usedUnitMaterial" }] },
        { model: ProductVariantIntermediateMaterial, as: "intermediateMaterials", required: false, where: { isActive: true }, include: [{ model: Packaging, as: "usedIntermediateMaterial" }] },
        { model: ProductVariantPalletMaterial, as: "palletMaterials", required: false, where: { isActive: true }, include: [{ model: Packaging, as: "usedPalletMaterial" }] },
    ] })
    return { subCategories, products, variants }
}

export function availableRawMaterials(products: Product[], subCategoryId: number): RawMaterial[] {
    const materials = new Map<number, RawMaterial>()
    products.filter(product => product.isActive && product.subCategoryId === subCategoryId).forEach(product => {
        (product.productRawMaterials ?? []).filter(row => row.isActive).forEach(row => {
            const raw = row.usedRawMaterial
            if (raw?.isActive && raw.isMixable && ["fruit", "vegetable", "pulp", "other"].includes(raw.ingredientType)
                && raw.costPerUnit != null && Number.isFinite(Number(raw.costPerUnit)) && Number(raw.costPerUnit) >= 0
                && raw.costUnit?.isActive && raw.costUnit.unitType === "weight" && Number.isFinite(Number(raw.costUnit.baseFactor)) && Number(raw.costUnit.baseFactor) > 0) materials.set(raw.id, raw)
        })
    })
    return [...materials.values()].sort((a, b) => a.id - b.id)
}

function packagingLevel<T extends { id?: number; packagingId: number; optionGroup: string | null; optionGroupId?: number | null; isDefault: boolean }>(rows: T[], packagingOf: (row: T) => Packaging) {
    const { fixedRows, groups } = bucketMaterialsByGroup(rows)
    const option = (row: T) => ({ id: row.id!, packagingId: row.packagingId, displayName: packagingOf(row).displayName, isDefault: row.isDefault })
    return { fixed: fixedRows.map(option), groups: [...groups.entries()].map(([key, group]) => ({ key, group: group.label, options: group.rows.map(option) })) }
}

export function configurationOption(variant: ProductVariant) {
    return { id: variant.id, fingerprint: digest(configurationIdentity(variant, variant.parentProduct.subCategoryId)),
        presentationId: variant.presentationId, displayLabel: variant.sizePresentation.displayLabel,
        netWeightGrams: Number(variant.sizePresentation.netWeightGrams), bagsPerBox: variant.bagsPerBox,
        boxesPerPallet: variant.boxesPerPallet, unitsPerIntermediatePackage: variant.unitsPerIntermediatePackage ?? null,
        packaging: {
            unit: packagingLevel(variant.unitMaterials ?? [], row => row.usedUnitMaterial),
            intermediate: packagingLevel(variant.intermediateMaterials ?? [], row => row.usedIntermediateMaterial),
            pallet: packagingLevel(variant.palletMaterials ?? [], row => row.usedPalletMaterial),
        } }
}

export async function discoverCatalog(language: ContentLanguage) {
    const { subCategories, products, variants } = await loadCatalogContext()
    const categories = new Map<number, { id: number; displayName: string; subCategories: { id: number; displayName: string; rawMaterials: { rawMaterialId: number; displayName: string; ingredientType: string; isOrganic: boolean }[]; configurations: ReturnType<typeof configurationOption>[] }[] }>()
    for (const subCategory of subCategories) {
        const rawMaterials = availableRawMaterials(products, subCategory.id)
        const unique = new Map<string, ReturnType<typeof configurationOption>>()
        variants.filter(variant => variant.parentProduct.subCategoryId === subCategory.id && validConfiguration(variant)).sort((a, b) => a.id - b.id).forEach(variant => {
            const option = configurationOption(variant)
            if (!unique.has(option.fingerprint)) unique.set(option.fingerprint, option)
        })
        if (!rawMaterials.length || !unique.size) continue
        const parent = subCategory.parentCategory
        const category: NonNullable<ReturnType<typeof categories.get>> = categories.get(parent.id) ?? { id: parent.id, displayName: pickTranslatedName(parent.displayName, parent.translations, language), subCategories: [] }
        category.subCategories.push({ id: subCategory.id, displayName: pickTranslatedName(subCategory.displayName, subCategory.translations, language),
            rawMaterials: rawMaterials.map(raw => ({ rawMaterialId: raw.id, displayName: pickTranslatedName(raw.displayName, raw.translations, language), ingredientType: raw.ingredientType, isOrganic: raw.isOrganic })),
            configurations: [...unique.values()] })
        categories.set(parent.id, category)
    }
    return { categories: [...categories.values()] }
}
