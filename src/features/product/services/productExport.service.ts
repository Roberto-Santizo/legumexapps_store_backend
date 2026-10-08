import ExcelJS from "exceljs"
import { Transaction, Model, ModelStatic } from "sequelize"
import Product from "../models/Product.model"
import ProductTranslation from "../models/ProductTranslation.model"
import ProductVariant from "../models/ProductVariant.model"
import ProductRawMaterial from "../models/ProductRawMaterial.model"
import ProductIngredient from "../models/ProductIngredient.model"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import ProductVariantIntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import Category from "../../category/models/Category.model"
import SubCategory from "../../category/models/SubCategory.model"
import Client from "../../client/models/Client.model"
import Presentation from "../../presentation/models/Presentation.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import Packaging from "../../packaging/models/Packaging.model"
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model"
import Unit from "../../unit/models/Unit.model"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import { AppError } from "../../../shared/errors/AppError"

const models = { products: Product, translations: ProductTranslation, variants: ProductVariant,
    recipes: ProductRawMaterial, ingredients: ProductIngredient, unitMaterials: ProductVariantUnitMaterial,
    intermediateMaterials: ProductVariantIntermediateMaterial, palletMaterials: ProductVariantPalletMaterial,
    categories: Category, subCategories: SubCategory, clients: Client, presentations: Presentation,
    rawMaterials: RawMaterial, ingredientCatalog: Ingredient, packagings: Packaging,
    groups: PackagingGroup, units: Unit, costs: ProcessingCost }
type Row = Record<string, unknown>
export type ProductExportData = Record<keyof typeof models, Row[]>
const number = (value: unknown): number | null => value == null ? null : Number(value)
const text = (value: unknown): string | null => value == null ? null : String(value)

// A report, not an import template: preserve inactive rows and all alternatives without recalculating prices.
export function buildProductExportWorkbook(data: ProductExportData, exportedAt = new Date()): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Legumex"
    workbook.created = exportedAt
    const lookup = (key: keyof ProductExportData, id: unknown): Row => indexes[key].get(Number(id)) ?? {}
    const indexes = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, new Map(rows.map(row => [Number(row.id), row]))])) as Record<keyof ProductExportData, Map<number, Row>>
    const productContext = (id: unknown) => [number(id), text(lookup("products", id).displayName)]
    const variantsByProduct = new Map<number, Row[]>()
    for (const variant of data.variants) {
        const productId = Number(variant.productId)
        const variants = variantsByProduct.get(productId) ?? []
        variants.push(variant)
        variantsByProduct.set(productId, variants)
    }
    const recipeVariants = (row: Row): Row[] => variantsByProduct.get(Number(row.productId)) ?? [{}]
    const recipeVariantContext = (variant: Row) => [text(variant.skuCode) ?? "Sin SKU / No SKU",
        text(lookup("presentations", variant.presentationId).displayLabel),
        variant.isActive == null ? null : Boolean(variant.isActive), number(variant.id)]
    const recipeVariantHeaders = ["SKU variante / Variant SKU", "Presentación / Presentation", "Variante activa / Active variant", "ID variante / Variant ID"]
    const variantContext = (id: unknown) => {
        const variant = lookup("variants", id)
        return [...productContext(variant.productId), number(id), text(variant.skuCode)]
    }
    const state = (row: Row) => row.isActive == null ? null : Boolean(row.isActive)
    function sheet(name: string, headers: string[], rows: (ExcelJS.CellValue[])[]) {
        const tab = workbook.addWorksheet(name)
        tab.columns = headers.map(header => ({ header, width: Math.min(45, Math.max(18, header.length + 2)) }))
        headers.forEach((header, index) => {
            // Keep technical references available, while showing commercial codes and names first.
            if (header === "ID" || header.startsWith("ID ")) tab.getColumn(index + 1).hidden = true
        })
        tab.addRows(rows)
        tab.views = [{ state: "frozen", ySplit: 1 }]
        tab.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, tab.rowCount), column: headers.length } }
        tab.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
        tab.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24543B" } }
        tab.getRow(1).alignment = { wrapText: true, vertical: "middle" }
        tab.getRow(1).height = 42
        tab.eachRow((row, index) => {
            if (index > 1) row.eachCell(cell => { if (typeof cell.value === "number" && !Number.isInteger(cell.value)) cell.numFmt = "0.0000" })
        })
    }
    const productHeaders = ["ID producto / Product ID", "Producto / Product"]
    const variantHeaders = [...productHeaders, "ID variante / Variant ID", "SKU / Código"]
    sheet("Productos", ["ID", "Nombre ES / ES name", "Nombre EN / EN name", "ID cliente / Client ID", "Cliente / Client", "ID categoría / Category ID", "Categoría / Category", "ID subcategoría / Subcategory ID", "Subcategoría / Subcategory", "Orgánico / Organic", "Personalizable / Customizable", "Costo adicional por unidad USD", "Activo / Active", "Slug", "Imagen / Image URL"], data.products.map(row => {
        const sub = lookup("subCategories", row.subCategoryId)
        return [number(row.id), text(row.displayName), text(data.translations.find(t => t.productId === row.id && t.language === "en")?.displayName), number(row.clientId), text(lookup("clients", row.clientId).name), number(sub.categoryId), text(lookup("categories", sub.categoryId).displayName), number(row.subCategoryId), text(sub.displayName), Boolean(row.isOrganic), Boolean(row.isCustomizable), number(row.additionalCostPerUnit), state(row), text(row.urlSlug), text(row.imageUrl)]
    }))
    sheet("Variantes", [...variantHeaders, "ID presentación / Presentation ID", "Presentación / Presentation", "Peso neto g / Net weight g", "Cajas por pallet / Boxes per pallet", "Unidades por caja / Units per box", "Unidades por empaque intermedio", "Activo / Active", "Presentación activa / Active presentation"], data.variants.map(row => {
        const size = lookup("presentations", row.presentationId)
        return [...productContext(row.productId), number(row.id), text(row.skuCode), number(row.presentationId), text(size.displayLabel), number(size.netWeightGrams), number(row.boxesPerPallet), number(row.bagsPerBox), number(row.unitsPerIntermediatePackage), state(row), state(size)]
    }))
    sheet("Materias primas", [...recipeVariantHeaders, ...productHeaders, "ID asociación / Association ID", "ID materia prima / Raw material ID", "Código materia prima / Raw material code", "Materia prima / Raw material", "Porcentaje / Percentage", "Mínimo % / Minimum %", "Máximo % / Maximum %", "Orden / Order", "Tipo / Type", "Orgánico / Organic", "Mezclable / Mixable", "Costo USD por unidad / Unit cost", "Unidad de costo / Cost unit", "Factor base g / Base factor g", "Asociación activa / Active association", "Material activo / Active material"], data.recipes.flatMap(row => {
        const raw = lookup("rawMaterials", row.rawMaterialId), unit = lookup("units", raw.costUnitId)
        return recipeVariants(row).map(variant => [...recipeVariantContext(variant), ...productContext(row.productId), number(row.id), number(row.rawMaterialId), text(raw.code), text(raw.displayName), number(row.percentage), number(row.minPercentage), number(row.maxPercentage), number(row.displayOrder), text(raw.ingredientType), state({ isActive: raw.isOrganic }), state({ isActive: raw.isMixable }), number(raw.costPerUnit), text(unit.displayName), number(unit.baseFactor), state(row), state(raw)])
    }))
    sheet("Ingredientes", [...recipeVariantHeaders, ...productHeaders, "ID asociación / Association ID", "ID ingrediente / Ingredient ID", "Código ingrediente / Ingredient code", "Ingrediente / Ingredient", "Gramos / Grams", "Peso referencia g / Reference weight g", "Orden / Order", "Costo USD por unidad / Unit cost", "Unidad de costo / Cost unit", "Factor base g / Base factor g", "Asociación activa / Active association", "Ingrediente activo / Active ingredient"], data.ingredients.flatMap(row => {
        const ingredient = lookup("ingredientCatalog", row.ingredientId), unit = lookup("units", ingredient.costUnitId)
        return recipeVariants(row).map(variant => [...recipeVariantContext(variant), ...productContext(row.productId), number(row.id), number(row.ingredientId), text(ingredient.code), text(ingredient.displayName), number(row.grams), number(row.referenceNetWeightGrams), number(row.displayOrder), number(ingredient.costPerUnit), text(unit.displayName), number(unit.baseFactor), state(row), state(ingredient)])
    }))
    for (const [name, key] of [["Empaques unidad", "unitMaterials"], ["Empaques intermedios", "intermediateMaterials"], ["Materiales pallet", "palletMaterials"]] as const) {
        sheet(name, [...variantHeaders, "ID asociación / Association ID", "ID empaque / Packaging ID", "Código / Code", "Empaque / Packaging", "Rol / Role", "Costo USD / Unit cost USD", "Cantidad configurada / Configured quantity", "Base configurada / Configured basis", "Unidades por empaque intermedio", "ID grupo / Group ID", "Grupo catálogo / Catalog group", "Grupo legacy / Legacy group", "Predeterminado / Default", "Asociación activa / Active association", "Empaque activo / Active packaging", "Base catálogo / Catalog basis", "Cantidad catálogo / Catalog quantity"], data[key].map(row => {
            const packaging = lookup("packagings", row.packagingId)
            return [...variantContext(row.productVariantId), number(row.id), number(row.packagingId), text(packaging.code), text(packaging.displayName), text(packaging.packagingRole), number(packaging.unitCost), number(key === "unitMaterials" ? row.quantityPerUnit : key === "palletMaterials" ? row.quantityValue : null), key === "unitMaterials" ? "per_unit" : key === "palletMaterials" ? text(row.quantityBasis) : "per_intermediate", number(lookup("variants", row.productVariantId).unitsPerIntermediatePackage), number(row.optionGroupId), text(lookup("groups", row.optionGroupId).displayName), text(row.optionGroup), Boolean(row.isDefault), state(row), state(packaging), text(packaging.defaultQuantityBasis), number(packaging.defaultQuantityValue)]
        }))
    }
    sheet("Costos globales", ["ID", "Nombre / Name", "Tipo de cálculo / Calculation type", "Valor / Value", "Activo / Active"], data.costs.map(row => [number(row.id), text(row.displayName), text(row.calculationType), number(row.value), state(row)]))
    sheet("Información", ["Concepto / Item", "Detalle / Details"], [
        ["Exportado UTC / Exported UTC", exportedAt.toISOString()],
        ["Alcance / Scope", "Todos los productos y asociaciones, activos e inactivos / All products and associations, active and inactive"],
        ["Relaciones / Relationships", "Product ID → Variant ID → SKU. Recipes and ingredients belong to Product; packaging belongs to Variant."],
        ["Lectura por SKU / Reading by SKU", "Materias primas e ingredientes se repiten por cada SKU del producto; la receta sigue siendo compartida. Los gramos corresponden al peso de referencia, no se recalculan por variante. Sin variantes: Sin SKU. / Recipes and ingredients repeat for each product SKU; the recipe remains shared. Grams use the reference weight, not recalculated per variant. No variants: No SKU."],
        ["IDs internos / Internal IDs", "Columnas ID ocultas para facilitar la lectura; se pueden mostrar en Excel. / ID columns are hidden for readability; they can be unhidden in Excel."],
        ["Receta / Recipe", "Fixed: percentage. Customizable: min/max. Ingredients are outside the 100% recipe; grams scale from reference weight."],
        ["Empaques / Packaging", "All fixed rows and alternatives included. Group + Default identify selections. Intermediate packaging uses ceil(total units / units per intermediate package)."],
        ["Costos / Costs", "USD. per_weight: USD/lb. percentage: 2 means 2%, applied to the shared quote subtotal. These are catalog values, not a calculated quotation."],
        ["Uso / Use", "Reporte de consulta; no reimportable ni respaldo completo de la base / Read-only report; not an import template or a full database backup."],
        ["Productos / Products", String(data.products.length)], ["Variantes / Variants", String(data.variants.length)],
    ])
    return workbook
}

async function exportProductCatalog(): Promise<Buffer> {
    if (!Product.sequelize) throw new AppError(503, "errors.internal")
    const data = await Product.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, async transaction => {
        const entries = await Promise.all(Object.entries(models).map(async ([key, model]) => [key, (await (model as ModelStatic<Model>).findAll({ transaction, order: [["id", "ASC"]] })).map(row => row.get({ plain: true }))]))
        return Object.fromEntries(entries) as ProductExportData
    })
    return Buffer.from(await buildProductExportWorkbook(data).xlsx.writeBuffer())
}
export const productExportService = { exportProductCatalog }
