import type { ParsedWorkbook, ParsedRow, ParsedWorksheet } from "../../../shared/utils/parsedWorkbook"
import { createHash } from "node:crypto"
import { Transaction } from "sequelize"
import { buildPackagingAssociationPlan, writePackagingAssociationPlan } from "./productPackagingImport.service"
import { parseInitialPackagingSheet } from "./initialPackagingImport.service"
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model"
import { MAX_PRODUCT_PACKAGING_IMPORT_ROWS } from "../constants/productPackagingImport.constant"
import { INITIAL_PRODUCT_SHEET, INITIAL_PACKAGING_SHEET, INITIAL_PACKAGING_COLUMNS, INITIAL_MATERIAL_TYPES } from "../constants/initialPackagingImport.constant"
import ExcelJS from "exceljs"
import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
import ProductVariant from "../models/ProductVariant.model"
import Presentation from "../../presentation/models/Presentation.model"
import { createProductVariantSchema, CreateProductVariantInput } from "../schemas/productVariant.schema"
import { skuCodeKey } from "./productSkuReference"
import ProductTranslation from "../models/ProductTranslation.model"
import SubCategory from "../../category/models/SubCategory.model"
import Category from "../../category/models/Category.model"
import Client from "../../client/models/Client.model"
import { AppError, BulkImportError, RowIssue } from "../../../shared/errors/AppError"
import { CreateProductInput, createProductSchema } from "../schemas/product.schema"
import { generateUniqueSlug } from "../../../shared/utils/slug.util"
import {
    ImportCellValue,
    isImportRowBlank,
    loadWorkbookFromBuffer,
    mapImportHeaders,
    normalizeImportText,
    parseImportBoolean,
    readImportCell,
    writeWorkbookToBuffer,
} from "../../../shared/utils/excelImport.util"
import {
    CUSTOMIZABLE_RECIPE_TOKENS,
    FIXED_RECIPE_TOKENS,
    MAX_PRODUCT_IMPORT_ROWS,
    PRODUCT_IMPORT_COLUMNS,
    ProductImportField,
    REQUIRED_PRODUCT_IMPORT_FIELDS,
} from "../constants/productImport.constant"

// Importación unificada: una fila por variante, producto agrupado por clave explícita.
type RowValidation = {
    rowNumber: number
    rowIssues: RowIssue[]
    manuallyValidatedFields: Set<string>
}

interface ProductImportCandidate {
    rowNumber: number
    input: CreateProductInput
    productGroup: string
    categoryId: number | null
    variant: Omit<CreateProductVariantInput, "productId">
}

interface NamedCatalogs {
    subCategoriesByNormalizedName: Map<string, SubCategory[]>
    categoriesByNormalizedName: Map<string, Category[]>
    clientsByNormalizedName: Map<string, Client[]>
}

// Resolución por buckets de nombres: el
// nombre no es único a nivel de columna (Subcategoría solo es única por (categoryId, urlSlug);
// Cliente no tiene ninguna restricción), así que cada nombre normalizado apunta a una LISTA -- 0
// coincidencias = no encontrado, >1 = ambiguo, cada uno como error de fila.
function bucketByNormalizedText<T>(rows: T[], getText: (row: T) => string): Map<string, T[]> {
    const byText = new Map<string, T[]>()
    for (const row of rows) {
        const key = normalizeImportText(getText(row))
        const bucket = byText.get(key) ?? []
        bucket.push(row)
        byText.set(key, bucket)
    }
    return byText
}

function isBlankCell(value: ImportCellValue): boolean {
    return value === null || String(value).trim() === ""
}

// "Categoría" (opcional): solo sirve para desambiguar Subcategorías con el mismo nombre en
// categorías distintas. null = columna vacía (no filtra); undefined = se escribió pero no resolvió
// (el error ya quedó registrado y la subcategoría no se intenta resolver, para no duplicar ruido).
function resolveCategoryField(rawCategory: ImportCellValue, catalogs: NamedCatalogs, ctx: RowValidation): number | null | undefined {
    if (isBlankCell(rawCategory)) return null
    const value = String(rawCategory).trim()
    const matches = catalogs.categoriesByNormalizedName.get(normalizeImportText(value)) ?? []
    if (matches.length === 0) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "category", key: "errors.bulk_import_category_not_found", params: { value } })
        return undefined
    }
    if (matches.length > 1) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "category", key: "errors.bulk_import_category_ambiguous", params: { value } })
        return undefined
    }
    return matches[0].id
}

function resolveSubCategoryField(
    rawSubCategory: ImportCellValue,
    categoryId: number | null | undefined,
    categoryLabel: string,
    catalogs: NamedCatalogs,
    ctx: RowValidation
): number | undefined {
    if (isBlankCell(rawSubCategory)) return undefined
    ctx.manuallyValidatedFields.add("subCategoryId")
    if (categoryId === undefined) return undefined

    const value = String(rawSubCategory).trim()
    const allMatches = catalogs.subCategoriesByNormalizedName.get(normalizeImportText(value)) ?? []
    const matches = categoryId === null ? allMatches : allMatches.filter(subCategory => subCategory.categoryId === categoryId)
    if (matches.length === 0) {
        const key = categoryId === null ? "errors.bulk_import_subcategory_not_found" : "errors.bulk_import_subcategory_not_found_in_category"
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "subCategory", key, params: { value, category: categoryLabel } })
        return undefined
    }
    if (matches.length > 1) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "subCategory", key: "errors.bulk_import_subcategory_ambiguous", params: { value } })
        return undefined
    }
    return matches[0].id
}

// Cliente = catálogo real de clientes (features/client/), NO salesperson/. Solo activos, mismo
// criterio que product.service.ts::assertClientExists.
function resolveClientField(rawClient: ImportCellValue, catalogs: NamedCatalogs, ctx: RowValidation): number | undefined {
    if (isBlankCell(rawClient)) return undefined
    ctx.manuallyValidatedFields.add("clientId")
    const value = String(rawClient).trim()
    const matches = catalogs.clientsByNormalizedName.get(normalizeImportText(value)) ?? []
    if (matches.length === 0) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "client", key: "errors.bulk_import_client_not_found", params: { value } })
        return undefined
    }
    if (matches.length > 1) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "client", key: "errors.bulk_import_client_ambiguous", params: { value } })
        return undefined
    }
    return matches[0].id
}

// "Tipo de receta" es obligatorio (decisión de negocio): cambia cómo se interpreta toda la receta
// del producto, así que no se asume "Fija" por omisión.
function resolveRecipeTypeField(rawRecipeType: ImportCellValue, ctx: RowValidation): boolean | undefined {
    if (isBlankCell(rawRecipeType)) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "recipeType", key: "errors.bulk_import_recipe_type_required" })
        return undefined
    }
    const normalized = normalizeImportText(rawRecipeType)
    if (FIXED_RECIPE_TOKENS.includes(normalized)) return false
    if (CUSTOMIZABLE_RECIPE_TOKENS.includes(normalized)) return true
    ctx.rowIssues.push({
        row: ctx.rowNumber,
        field: "recipeType",
        key: "errors.bulk_import_invalid_recipe_type",
        params: { value: String(rawRecipeType).trim() }
    })
    return undefined
}

function resolveIsOrganicField(rawIsOrganic: ImportCellValue, ctx: RowValidation): boolean {
    const isOrganic = parseImportBoolean(rawIsOrganic, false)
    if (isOrganic === undefined) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "isOrganic", key: "errors.bulk_import_invalid_boolean", params: { value: rawIsOrganic } })
        return false
    }
    return isOrganic
}

function collectRowZodIssues(
    candidate: unknown,
    manuallyValidatedFields: Set<string>,
    rowNumber: number
): { validated?: CreateProductInput; issues: RowIssue[] } {
    const result = createProductSchema.safeParse(candidate)
    if (result.success) return { validated: result.data, issues: [] }

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push({ row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return { issues }
}

function readTrimmedText(value: ImportCellValue): string | undefined {
    if (isBlankCell(value)) return undefined
    return String(value).trim()
}

function processProductImportRow(
    row: ParsedRow, rowNumber: number, columns: Map<ProductImportField, number>,
    catalogs: NamedCatalogs, presentations: Map<string, Presentation[]>,
    existingSkus: Set<string>, firstSkuRows: Map<string, number>, rowIssues: RowIssue[]
): ProductImportCandidate | null {
    const read = (field: ProductImportField) => readImportCell(row, columns.get(field))
    const ctx: RowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set() }
    const productGroup = readTrimmedText(read("productGroup"))
    if (!productGroup) ctx.rowIssues.push({ row: rowNumber, field: "productGroup", key: "errors.bulk_import_product_group_required" })
    const category = readTrimmedText(read("category")) ?? ""
    const categoryId = resolveCategoryField(read("category"), catalogs, ctx)
    const subCategoryId = resolveSubCategoryField(read("subCategory"), categoryId, category, catalogs, ctx)
    const clientId = resolveClientField(read("client"), catalogs, ctx)
    const isCustomizable = resolveRecipeTypeField(read("recipeType"), ctx)
    const isOrganic = resolveIsOrganicField(read("isOrganic"), ctx)
    const en = readTrimmedText(read("displayNameEn"))
    const { validated, issues } = collectRowZodIssues({
        subCategoryId, clientId, displayName: readTrimmedText(read("displayName")), isCustomizable, isOrganic,
        additionalCostPerUnit: isBlankCell(read("additionalCostPerUnit")) ? null : Number(read("additionalCostPerUnit")),
        ...(en ? { translations: { en: { displayName: en } } } : {}),
    }, ctx.manuallyValidatedFields, rowNumber)
    ctx.rowIssues.push(...issues)
    const label = readTrimmedText(read("presentationLabel")) ?? ""
    const matches = presentations.get(normalizeImportText(label)) ?? []
    if (matches.length !== 1) ctx.rowIssues.push({ row: rowNumber, field: "presentationLabel",
        key: matches.length ? "errors.bulk_import_presentation_ambiguous" : "errors.bulk_import_presentation_not_found", params: { value: label } })
    const number = (field: ProductImportField) => isBlankCell(read(field)) ? undefined : Number(read(field))
    const parsed = createProductVariantSchema.omit({ productId: true }).safeParse({
        skuCode: readTrimmedText(read("skuCode")), presentationId: matches[0]?.id,
        boxesPerPallet: number("boxesPerPallet"), bagsPerBox: number("bagsPerBox"),
        unitsPerIntermediatePackage: number("unitsPerIntermediatePackage"),
    })
    if (!parsed.success) for (const issue of parsed.error.issues) {
        if (issue.path[0] === "presentationId" && matches.length !== 1) continue
        ctx.rowIssues.push({ row: rowNumber, field: issue.path.join("."), key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    const sku = readTrimmedText(read("skuCode"))
    if (sku) {
        const key = skuCodeKey(sku)
        if (existingSkus.has(key)) ctx.rowIssues.push({ row: rowNumber, field: "skuCode", key: "errors.product_variant_skucode_already_exists", params: { skuCode: sku } })
        const firstRow = firstSkuRows.get(key)
        if (firstRow !== undefined) ctx.rowIssues.push({ row: rowNumber, field: "skuCode", key: "errors.bulk_import_duplicate_code_in_file", params: { code: sku, firstRow } })
        else firstSkuRows.set(key, rowNumber)
    }
    rowIssues.push(...ctx.rowIssues)
    if (!validated || !parsed.success || !productGroup || ctx.rowIssues.length) return null
    return { rowNumber, input: validated, productGroup, categoryId: categoryId ?? null, variant: parsed.data }
}

async function loadNamedCatalogs(transaction?: Transaction): Promise<NamedCatalogs> {
    const options = transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}
    const [subCategories, categories, clients] = await Promise.all([
        SubCategory.findAll({ ...options, where: { isActive: true } }),
        Category.findAll({ ...options, where: { isActive: true } }),
        Client.findAll({ ...options, where: { isActive: true } }),
    ])
    return {
        subCategoriesByNormalizedName: bucketByNormalizedText(subCategories, subCategory => subCategory.displayName),
        categoriesByNormalizedName: bucketByNormalizedText(categories, category => category.displayName),
        clientsByNormalizedName: bucketByNormalizedText(clients, client => client.name),
    }
}

function validateProductImportHeaders(sheet: ParsedWorksheet): Map<ProductImportField, number> {
    const columnIndexByField = mapImportHeaders(sheet.getRow(1), PRODUCT_IMPORT_COLUMNS)
    const missingFields = REQUIRED_PRODUCT_IMPORT_FIELDS.filter(field => !columnIndexByField.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => PRODUCT_IMPORT_COLUMNS[field].header).join(", ")
        })
    }
    return columnIndexByField
}

async function buildProductImportPlan(buffer: Buffer, transaction?: Transaction) {
    if (!buffer.length) throw new AppError(422, "errors.bulk_import_empty_file")
    if (buffer.length > 5 * 1024 * 1024) throw new AppError(422, "errors.packaging_association_import.file_size")
    const workbook: ParsedWorkbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets.find(row => normalizeImportText(row.name) === normalizeImportText(INITIAL_PRODUCT_SHEET)) ?? workbook.worksheets[0]
    const materialSheet = workbook.worksheets.find(row => normalizeImportText(row.name) === normalizeImportText(INITIAL_PACKAGING_SHEET))
    if (!sheet || sheet.rowCount <= 1) throw new AppError(422, "errors.bulk_import_empty_file")
    const columns = validateProductImportHeaders(sheet)
    if (sheet.rowCount - 1 > MAX_PRODUCT_IMPORT_ROWS) throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PRODUCT_IMPORT_ROWS })
    const options = transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}
    const [catalogs, variants, products, presentationRows] = await Promise.all([
        loadNamedCatalogs(transaction), ProductVariant.findAll({ ...options, attributes: ["skuCode"] }),
        Product.findAll({ ...options, attributes: ["urlSlug"] }), Presentation.findAll({ ...options, where: { isActive: true } }),
    ])
    const presentations = bucketByNormalizedText(presentationRows, p => p.displayLabel)
    const existingSkus = new Set(variants.map(v => skuCodeKey(v.skuCode)))
    const firstSkuRows = new Map<string, number>()
    const groups = new Map<string, ProductImportCandidate[]>()
    const rowIssues: RowIssue[] = []
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        let formula = false
        row.eachCell(cell => {
            if (typeof cell.value === "object" && cell.value && ("formula" in cell.value || "sharedFormula" in cell.value)) formula = true
        })
        if (formula) { rowIssues.push({ row: rowNumber, field: "row", key: "errors.packaging_association_import.formula" }); continue }
        if (isImportRowBlank(row, columns)) continue
        const candidate = processProductImportRow(row, rowNumber, columns, catalogs, presentations, existingSkus, firstSkuRows, rowIssues)
        if (!candidate) continue
        // La clave se compara literalmente después de trim; nombres no intervienen.
        const rows = groups.get(candidate.productGroup) ?? []
        rows.push(candidate)
        groups.set(candidate.productGroup, rows)
    }
    for (const [group, rows] of groups) {
        const first = rows[0]
        const presentationsSeen = new Set<number>()
        for (const row of rows) {
            if (row.categoryId !== first.categoryId) rowIssues.push({ row: row.rowNumber, field: "category", key: "errors.bulk_import_product_group_inconsistent", params: { group, field: "category", firstRow: first.rowNumber } })
            for (const field of ["displayName", "clientId", "subCategoryId", "isOrganic", "isCustomizable", "additionalCostPerUnit", "translations"] as const) {
                if (JSON.stringify(row.input[field]) !== JSON.stringify(first.input[field])) {
                    rowIssues.push({ row: row.rowNumber, field, key: "errors.bulk_import_product_group_inconsistent", params: { group, field, firstRow: first.rowNumber } })
                }
            }
            if (presentationsSeen.has(row.variant.presentationId)) rowIssues.push({ row: row.rowNumber, field: "presentationId", key: "errors.product_variant_presentation_already_used" })
            presentationsSeen.add(row.variant.presentationId)
        }
    }
    if (!groups.size && !rowIssues.length) throw new AppError(422, "errors.bulk_import_empty_file")
    const takenSlugs = new Set(products.map(p => p.urlSlug))
    const slugs = new Map<string, string>()
    for (const [group, rows] of groups) {
        const slug = await generateUniqueSlug(rows[0].input.displayName, async candidate => takenSlugs.has(candidate))
        takenSlugs.add(slug)
        slugs.set(group, slug)
    }
    const initialVariants = [...groups.values()].flat().map(row => ({ ...row.variant, id: row.rowNumber, productId: row.rowNumber, isActive: true }))
    const materialRows = parseInitialPackagingSheet(materialSheet)
    const materials = materialSheet ? await buildPackagingAssociationPlan(materialRows, transaction, {
        variants: initialVariants,
        products: initialVariants.map(row => ({ id: row.productId, isActive: true })),
    }) : null
    const materialIssues = materials?.plan.flatMap(row => row.preview.issues) ?? []
    const issues = [...rowIssues.map(issue => ({ ...issue, sheet: INITIAL_PRODUCT_SHEET })), ...materialIssues.map(issue => ({ ...issue, sheet: INITIAL_PACKAGING_SHEET }))]
    const summary = {
        products: groups.size, variants: initialVariants.length,
        unit: materials?.plan.filter(row => row.preview.level === "unit").length ?? 0,
        intermediate: materials?.plan.filter(row => row.preview.level === "intermediate").length ?? 0,
        pallet: materials?.plan.filter(row => row.preview.level === "pallet").length ?? 0,
        errors: issues.length, warnings: materials?.plan.reduce((total, row) => total + row.preview.warnings.length, 0) ?? 0,
    }
    const productRows = [...groups.values()].flat().map(row => ({ row: row.rowNumber, productGroup: row.productGroup,
        skuCode: row.variant.skuCode, displayName: row.input.displayName, presentationId: row.variant.presentationId,
        presentation: presentationRows.find(presentation => presentation.id === row.variant.presentationId)?.displayLabel ?? "",
        boxesPerPallet: row.variant.boxesPerPallet, bagsPerBox: row.variant.bagsPerBox, unitsPerIntermediatePackage: row.variant.unitsPerIntermediatePackage ?? null }))
    const previewHash = createHash("sha256").update(JSON.stringify({ file: createHash("sha256").update(buffer).digest("hex"), productRows,
        inputs: [...groups.entries()], slugs: [...slugs.entries()], existingSkus: [...existingSkus].sort(), takenSlugs: [...takenSlugs].sort(),
        catalogs: Object.fromEntries(Object.entries(catalogs).map(([key, value]) => [key, [...value.entries()]])),
        presentations: presentationRows, packagingHash: materials?.previewHash ?? null,
    })).digest("hex")
    return { groups, slugs, materials, issues, summary, productRows, previewHash }
}

type ProductImportPlan = Awaited<ReturnType<typeof buildProductImportPlan>>
async function writeProductImportPlan(plan: ProductImportPlan, transaction: Transaction) {
    if (plan.issues.length) throw new BulkImportError(plan.issues)
    const variantIds = new Map<number, number>()
    for (const [group, rows] of plan.groups) {
        const { translations, ...input } = rows[0].input
        const product = await Product.create({ ...input, urlSlug: plan.slugs.get(group), imageUrl: null }, { transaction })
        if (translations?.en?.displayName) await ProductTranslation.create({ productId: product.id, language: "en", displayName: translations.en.displayName }, { transaction })
        for (const row of rows) {
            const variant = await ProductVariant.create({ ...row.variant, productId: product.id, unitsPerIntermediatePackage: row.variant.unitsPerIntermediatePackage ?? null }, { transaction })
            variantIds.set(row.rowNumber, variant.id)
        }
    }
    if (plan.materials) await writePackagingAssociationPlan(plan.materials.plan, transaction, variantIds)
    return { products: plan.summary.products, variants: plan.summary.variants }
}

async function bulkImportProducts(buffer: Buffer): Promise<{ products: number; variants: number }> {
    const plan = await buildProductImportPlan(buffer)
    if (plan.issues.length) throw new BulkImportError(plan.issues)
    return sequelize.transaction(transaction => writeProductImportPlan(plan, transaction))
}

async function previewProductImport(buffer: Buffer) {
    const plan = await buildProductImportPlan(buffer)
    return { previewHash: plan.previewHash, summary: plan.summary, products: plan.productRows,
        materials: plan.materials?.plan.map(row => row.preview) ?? [], issues: plan.issues }
}

async function confirmProductImport(buffer: Buffer, previewHash: string) {
    if (!/^[a-f0-9]{64}$/.test(previewHash)) throw new AppError(422, "errors.packaging_association_import.preview_required")
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async transaction => {
        const plan = await buildProductImportPlan(buffer, transaction)
        if (plan.issues.length) throw new BulkImportError(plan.issues)
        if (plan.previewHash !== previewHash) throw new AppError(409, "errors.packaging_association_import.stale_preview")
        await writeProductImportPlan(plan, transaction)
        return plan.summary
    })
}

async function buildProductImportTemplate(instructions: string[] = []): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(INITIAL_PRODUCT_SHEET)
    sheet.columns = Object.entries(PRODUCT_IMPORT_COLUMNS).map(([key, column]) => ({ header: column.header.toUpperCase(), key, width: 28 }))
    sheet.getColumn("skuCode").numFmt = "@"; sheet.getColumn("productGroup").numFmt = "@"
    const materials = workbook.addWorksheet(INITIAL_PACKAGING_SHEET)
    materials.columns = Object.entries(INITIAL_PACKAGING_COLUMNS).map(([key, column]) => ({ header: column.header, key, width: 28 }))
    materials.getColumn("skuCode").numFmt = "@"; materials.getColumn("packagingCode").numFmt = "@"
    for (const tab of [sheet, materials]) {
        tab.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
        tab.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24543B" } }
        tab.getRow(1).height = 32
        tab.views = [{ state: "frozen", ySplit: 1 }]
        tab.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: tab.columnCount } }
    }
    const help = workbook.addWorksheet("INSTRUCCIONES")
    help.columns = [{ header: "Instrucciones / Instructions", key: "help", width: 130 }]
    help.getRow(1).font = { bold: true }
    for (const line of instructions) help.addRow({ help: line })
    help.addRow({ help: "Productos y Variantes: ASIAN-1 | AB-816 | Bolsa 16 oz | 60 | 8 | 6 | Congelados | [vacío] | Walmart | Asian Blend | Asian Blend | NO | Fija | [vacío]" })
    for (const type of Object.keys(INITIAL_MATERIAL_TYPES)) help.addRow({ help: `Materiales de Empaque: AB-816 | CODIGO-MP-REAL | ${type} | [grupo real o vacío] | [SI/NO con grupo] | ${type === "OTRO PALETIZACIÓN" ? "POR PALLET | 2.5" : "[vacío] | [vacío]"}` })
    const groups = await PackagingGroup.findAll({ where: { isActive: true }, order: [["displayName", "ASC"]] })
    const firstGroupRow = help.rowCount + 2
    help.addRow({ help: "PackagingGroup" })
    for (const group of groups) help.addRow({ help: group.displayName })
    if (groups.length) workbook.definedNames.add(`'INSTRUCCIONES'!$A$${firstGroupRow}:$A$${firstGroupRow + groups.length - 1}`, "InitialPackagingGroups")
    for (let row = 2; row <= MAX_PRODUCT_PACKAGING_IMPORT_ROWS + 1; row++) {
        materials.getCell(row, 3).dataValidation = { type: "list", allowBlank: false, formulae: [`"${Object.keys(INITIAL_MATERIAL_TYPES).join(",")}"`] }
        materials.getCell(row, 5).dataValidation = { type: "list", allowBlank: true, formulae: ['"SI,NO"'] }
        materials.getCell(row, 6).dataValidation = { type: "list", allowBlank: true, formulae: ['"POR CAJA,POR PALLET"'] }
        if (groups.length) materials.getCell(row, 4).dataValidation = { type: "list", allowBlank: true, formulae: ["InitialPackagingGroups"] }
    }
    return writeWorkbookToBuffer(workbook)
}

export const productImportService = { bulkImportProducts, previewProductImport, confirmProductImport, buildProductImportTemplate }
