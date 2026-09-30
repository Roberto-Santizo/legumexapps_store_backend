import CustomQuoteRawMaterialOption from "../models/CustomQuoteRawMaterialOption.model"
import CustomQuoteIngredientOption from "../models/CustomQuoteIngredientOption.model"
import CustomQuotePresentationOption from "../models/CustomQuotePresentationOption.model"
import CustomQuotePackagingOption from "../models/CustomQuotePackagingOption.model"
import SubCategory from "../../category/models/SubCategory.model"
import SubCategoryTranslation from "../../category/models/SubCategoryTranslation.model"
import Category from "../../category/models/Category.model"
import CategoryTranslation from "../../category/models/CategoryTranslation.model"
import Presentation from "../../presentation/models/Presentation.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../../rawMaterial/models/RawMaterialTranslation.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import IngredientTranslation from "../../ingredient/models/IngredientTranslation.model"
import Packaging from "../../packaging/models/Packaging.model"
import { MaterialLevel, bucketMaterialsByGroup } from "../../quote/services/quoteMaterialSelection"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE, pickTranslatedName } from "../../../shared/utils/translation.util"

// Menú del wizard a la medida (GET /custom-quotes/catalog): todo lo que un representante puede elegir,
// armado desde las listas de permitidos (solo filas activas cuyo elemento de catálogo sigue activo) y
// en su idioma. Un solo pedido: las listas son chicas y el wizard necesita todo para validar en vivo.
// Los empaques se agrupan con el MISMO bucketMaterialsByGroup que usa el motor, así el menú y lo que
// calculateCustomQuote acepta no pueden divergir. DECIMALs casteados a número (§8).

export interface CustomQuoteCatalogRawMaterial {
    rawMaterialId: number
    displayName: string
    isOrganic: boolean
    isMixable: boolean
    // "other" = insumo sin variante orgánica (agua, sal...): compatible con orgánico igual.
    ingredientType: string
    minPercentage: number
    maxPercentage: number
}

export interface CustomQuoteCatalogSubCategory {
    id: number
    displayName: string
    rawMaterials: CustomQuoteCatalogRawMaterial[]
}

export interface CustomQuoteCatalogCategory {
    id: number
    displayName: string
    imageUrl: string | null
    subCategories: CustomQuoteCatalogSubCategory[]
}

export interface CustomQuoteCatalogIngredient {
    ingredientId: number
    displayName: string
    maxGramsPerKg: number | null
}

export interface CustomQuoteCatalogPresentation {
    presentationId: number
    displayLabel: string
    netWeightGrams: number
    boxesPerPallet: number
    bagsPerBox: number
    unitsPerIntermediatePackage: number | null
}

// Misma forma que QuotableMaterialOptionGroup de productos definidos (id = id de la fila de la lista,
// el que espera selectedXPackagingOptionIds).
interface CustomQuoteCatalogPackagingOption {
    id: number
    packagingId: number
    displayName: string
    unitCost: number
    isDefault: boolean
}

export interface CustomQuoteCatalogPackagingLevel {
    // Siempre incluidos (sin grupo): solo nombres, para mostrar "Incluye: …".
    fixed: { id: number; packagingId: number; displayName: string }[]
    groups: { group: string; options: CustomQuoteCatalogPackagingOption[] }[]
}

export interface CustomQuoteCatalog {
    categories: CustomQuoteCatalogCategory[]
    ingredients: CustomQuoteCatalogIngredient[]
    presentations: CustomQuoteCatalogPresentation[]
    packaging: Record<MaterialLevel, CustomQuoteCatalogPackagingLevel>
}

function byDisplayName<T extends { displayName: string }>(a: T, b: T): number {
    return a.displayName.localeCompare(b.displayName)
}

// Categoría -> subcategoría -> materias primas. Solo aparecen subcategorías (y categorías) que tienen al
// menos una materia prima ofrecida: sin eso no se puede armar ninguna receta.
async function buildCategories(language: ContentLanguage): Promise<CustomQuoteCatalogCategory[]> {
    const options = await CustomQuoteRawMaterialOption.findAll({
        where: { isActive: true },
        include: [
            {
                model: RawMaterial,
                as: "usedRawMaterial",
                where: { isActive: true },
                required: true,
                include: [{ model: RawMaterialTranslation, as: "translations" }]
            },
            {
                model: SubCategory,
                as: "subCategory",
                where: { isActive: true },
                required: true,
                include: [
                    { model: SubCategoryTranslation, as: "translations" },
                    {
                        model: Category,
                        as: "parentCategory",
                        where: { isActive: true },
                        required: true,
                        include: [{ model: CategoryTranslation, as: "translations" }]
                    }
                ]
            }
        ]
    })

    const categories = new Map<number, CustomQuoteCatalogCategory>()
    const subCategories = new Map<number, CustomQuoteCatalogSubCategory>()

    for (const option of options) {
        const subCategory = option.subCategory
        const category = subCategory.parentCategory
        const rawMaterial = option.usedRawMaterial

        let categoryEntry = categories.get(category.id)
        if (!categoryEntry) {
            categoryEntry = {
                id: category.id,
                displayName: pickTranslatedName(category.displayName, category.translations, language),
                imageUrl: category.imageUrl ?? null,
                subCategories: [],
            }
            categories.set(category.id, categoryEntry)
        }

        let subCategoryEntry = subCategories.get(subCategory.id)
        if (!subCategoryEntry) {
            subCategoryEntry = {
                id: subCategory.id,
                displayName: pickTranslatedName(subCategory.displayName, subCategory.translations, language),
                rawMaterials: [],
            }
            subCategories.set(subCategory.id, subCategoryEntry)
            categoryEntry.subCategories.push(subCategoryEntry)
        }

        subCategoryEntry.rawMaterials.push({
            rawMaterialId: rawMaterial.id,
            displayName: pickTranslatedName(rawMaterial.displayName, rawMaterial.translations, language),
            isOrganic: rawMaterial.isOrganic,
            isMixable: rawMaterial.isMixable,
            ingredientType: rawMaterial.ingredientType,
            minPercentage: option.minPercentage !== null && option.minPercentage !== undefined ? Number(option.minPercentage) : 0,
            maxPercentage: option.maxPercentage !== null && option.maxPercentage !== undefined ? Number(option.maxPercentage) : 100,
        })
    }

    return [...categories.values()]
        .map(category => ({
            ...category,
            subCategories: category.subCategories
                .map(subCategory => ({ ...subCategory, rawMaterials: [...subCategory.rawMaterials].sort(byDisplayName) }))
                .sort(byDisplayName),
        }))
        .sort(byDisplayName)
}

async function buildIngredients(language: ContentLanguage): Promise<CustomQuoteCatalogIngredient[]> {
    const options = await CustomQuoteIngredientOption.findAll({
        where: { isActive: true },
        include: [{
            model: Ingredient,
            as: "usedIngredient",
            where: { isActive: true },
            required: true,
            include: [{ model: IngredientTranslation, as: "translations" }]
        }]
    })
    return options
        .map(option => ({
            ingredientId: option.ingredientId,
            displayName: pickTranslatedName(option.usedIngredient.displayName, option.usedIngredient.translations, language),
            maxGramsPerKg: option.maxGramsPerKg !== null && option.maxGramsPerKg !== undefined ? Number(option.maxGramsPerKg) : null,
        }))
        .sort(byDisplayName)
}

async function buildPresentations(): Promise<CustomQuoteCatalogPresentation[]> {
    const options = await CustomQuotePresentationOption.findAll({
        where: { isActive: true },
        include: [{ model: Presentation, as: "presentation", where: { isActive: true }, required: true }]
    })
    return options
        .map(option => ({
            presentationId: option.presentationId,
            displayLabel: option.presentation.displayLabel,
            netWeightGrams: Number(option.presentation.netWeightGrams ?? 0),
            boxesPerPallet: option.boxesPerPallet,
            bagsPerBox: option.bagsPerBox,
            unitsPerIntermediatePackage: option.unitsPerIntermediatePackage ?? null,
        }))
        // Sin peso neto no se puede costear (el servicio de la lista ya lo impide al guardar).
        .filter(presentation => presentation.netWeightGrams > 0)
        .sort((a, b) => a.netWeightGrams - b.netWeightGrams || a.displayLabel.localeCompare(b.displayLabel))
}

function buildPackagingLevel(rows: CustomQuotePackagingOption[]): CustomQuoteCatalogPackagingLevel {
    const { fixedRows, groups } = bucketMaterialsByGroup(rows)
    return {
        fixed: fixedRows.map(row => ({ id: row.id, packagingId: row.packagingId, displayName: row.packaging?.displayName ?? "" })),
        groups: [...groups.values()].map(bucket => ({
            group: bucket.label,
            options: bucket.rows.map(row => ({
                id: row.id,
                packagingId: row.packagingId,
                displayName: row.packaging?.displayName ?? "",
                unitCost: Number(row.packaging?.unitCost ?? 0),
                isDefault: row.isDefault,
            })),
        })),
    }
}

async function buildPackaging(): Promise<Record<MaterialLevel, CustomQuoteCatalogPackagingLevel>> {
    const options = await CustomQuotePackagingOption.findAll({
        where: { isActive: true },
        include: [{ model: Packaging, as: "packaging", where: { isActive: true }, required: true }]
    })
    const rowsFor = (level: MaterialLevel) => options.filter(option => option.packaging?.packagingRole === level)
    return {
        unit: buildPackagingLevel(rowsFor("unit")),
        intermediate: buildPackagingLevel(rowsFor("intermediate")),
        pallet: buildPackagingLevel(rowsFor("pallet")),
    }
}

async function getCatalog(language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<CustomQuoteCatalog> {
    const [categories, ingredients, presentations, packaging] = await Promise.all([
        buildCategories(language),
        buildIngredients(language),
        buildPresentations(),
        buildPackaging(),
    ])
    return { categories, ingredients, presentations, packaging }
}

export const customQuoteCatalogService = {
    getCatalog,
}
