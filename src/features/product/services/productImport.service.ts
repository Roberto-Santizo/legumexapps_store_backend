import ExcelJS from "exceljs"
import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
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

// Carga masiva de Productos base (2026-09-25) -- paso 1 de 3 (Productos → Recetas → SKUs, ver
// CLAUDE.md #4). Solo CREA productos (create-only), todo-o-nada por archivo. Cada fila se valida
// con el mismo createProductSchema que el formulario manual, sin imagen: el producto se crea con
// imageUrl null y la imagen se sube después en su pantalla de edición.

type RowValidation = {
    rowNumber: number
    rowIssues: RowIssue[]
    manuallyValidatedFields: Set<string>
}

interface ProductImportCandidate {
    rowNumber: number
    input: CreateProductInput
}

interface NamedCatalogs {
    subCategoriesByNormalizedName: Map<string, SubCategory[]>
    categoriesByNormalizedName: Map<string, Category[]>
    clientsByNormalizedName: Map<string, Client[]>
}

// Mismo patrón que loadPresentationsByNormalizedLabel en productVariantImport.service.ts: el
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

// "Tipo de receta" es obligatorio (decisión 2026-09-25): cambia cómo se interpreta toda la receta
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

// Código único sin importar mayúsculas contra TODOS los productos (activos o no, igual que
// product.service.ts::assertCodigoIsUnique) y dentro del mismo archivo.
function checkCodigoUniqueness(
    codigo: string,
    existingNormalizedCodigos: Set<string>,
    firstRowByNormalizedCodigo: Map<string, number>,
    ctx: RowValidation
): void {
    const normalized = normalizeImportText(codigo)
    if (normalized === "") return
    if (existingNormalizedCodigos.has(normalized)) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "codigo", key: "errors.product_codigo_already_exists", params: { codigo } })
        return
    }
    const firstRow = firstRowByNormalizedCodigo.get(normalized)
    if (firstRow !== undefined) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "codigo", key: "errors.bulk_import_duplicate_code_in_file", params: { code: codigo, firstRow } })
        return
    }
    firstRowByNormalizedCodigo.set(normalized, ctx.rowNumber)
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
    row: ExcelJS.Row,
    rowNumber: number,
    columnIndexByField: Map<ProductImportField, number>,
    catalogs: NamedCatalogs,
    existingNormalizedCodigos: Set<string>,
    firstRowByNormalizedCodigo: Map<string, number>,
    rowIssues: RowIssue[]
): ProductImportCandidate | null {
    const read = (field: ProductImportField) => readImportCell(row, columnIndexByField.get(field))
    const rawCategory = read("category")
    const rawAdditionalCost = read("additionalCostPerUnit")

    const ctx: RowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }

    const codigo = readTrimmedText(read("codigo"))
    if (codigo) checkCodigoUniqueness(codigo, existingNormalizedCodigos, firstRowByNormalizedCodigo, ctx)

    const categoryId = resolveCategoryField(rawCategory, catalogs, ctx)
    const subCategoryId = resolveSubCategoryField(read("subCategory"), categoryId, readTrimmedText(rawCategory) ?? "", catalogs, ctx)
    const clientId = resolveClientField(read("client"), catalogs, ctx)
    const isCustomizable = resolveRecipeTypeField(read("recipeType"), ctx)
    const isOrganic = resolveIsOrganicField(read("isOrganic"), ctx)
    const displayNameEn = readTrimmedText(read("displayNameEn"))

    const candidate = {
        codigo,
        subCategoryId,
        clientId,
        displayName: readTrimmedText(read("displayName")),
        isOrganic,
        isCustomizable,
        additionalCostPerUnit: isBlankCell(rawAdditionalCost) ? undefined : Number(rawAdditionalCost),
        ...(displayNameEn ? { translations: { en: { displayName: displayNameEn } } } : {}),
    }

    const { validated, issues: zodIssues } = collectRowZodIssues(candidate, ctx.manuallyValidatedFields, rowNumber)
    ctx.rowIssues.push(...zodIssues)

    if (ctx.rowIssues.length > 0) {
        rowIssues.push(...ctx.rowIssues)
        return null
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- rowIssues vacío arriba garantiza que zod sí validó
    return { rowNumber, input: validated! }
}

async function loadNamedCatalogs(): Promise<NamedCatalogs> {
    const [subCategories, categories, clients] = await Promise.all([
        SubCategory.findAll({ where: { isActive: true } }),
        Category.findAll({ where: { isActive: true } }),
        Client.findAll({ where: { isActive: true } }),
    ])
    return {
        subCategoriesByNormalizedName: bucketByNormalizedText(subCategories, subCategory => subCategory.displayName),
        categoriesByNormalizedName: bucketByNormalizedText(categories, category => category.displayName),
        clientsByNormalizedName: bucketByNormalizedText(clients, client => client.name),
    }
}

// Todos los productos (activos o no): el código y el slug son únicos en toda la tabla.
async function loadExistingCodigosAndSlugs(): Promise<{ codigos: Set<string>; slugs: Set<string> }> {
    const products = await Product.findAll({ attributes: ["codigo", "urlSlug"] })
    return {
        codigos: new Set(products.map(product => normalizeImportText(product.codigo))),
        slugs: new Set(products.map(product => product.urlSlug)),
    }
}

function validateProductImportHeaders(sheet: ExcelJS.Worksheet): Map<ProductImportField, number> {
    const columnIndexByField = mapImportHeaders(sheet.getRow(1), PRODUCT_IMPORT_COLUMNS)
    const missingFields = REQUIRED_PRODUCT_IMPORT_FIELDS.filter(field => !columnIndexByField.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => PRODUCT_IMPORT_COLUMNS[field].header).join(", ")
        })
    }
    return columnIndexByField
}

async function bulkImportProducts(buffer: Buffer): Promise<Product[]> {
    const workbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    const columnIndexByField = validateProductImportHeaders(sheet)

    if (sheet.rowCount - 1 > MAX_PRODUCT_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PRODUCT_IMPORT_ROWS })
    }

    const [catalogs, existing] = await Promise.all([loadNamedCatalogs(), loadExistingCodigosAndSlugs()])

    const rowIssues: RowIssue[] = []
    const candidates: ProductImportCandidate[] = []
    const firstRowByNormalizedCodigo = new Map<string, number>()

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const candidate = processProductImportRow(
            row, rowNumber, columnIndexByField, catalogs, existing.codigos, firstRowByNormalizedCodigo, rowIssues
        )
        if (candidate) candidates.push(candidate)
    }

    if (rowIssues.length > 0) {
        throw new BulkImportError(rowIssues)
    }
    if (candidates.length === 0) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    // Slugs resueltos en memoria antes de escribir: el set arranca con los slugs de la BD y va
    // sumando los de filas anteriores del MISMO archivo, así dos productos con el mismo nombre
    // reciben "nombre" y "nombre-2" en vez de chocar contra el índice único al insertar.
    const takenSlugs = existing.slugs
    const slugByRow = new Map<number, string>()
    for (const candidate of candidates) {
        const urlSlug = await generateUniqueSlug(candidate.input.displayName, async (slugCandidate) => takenSlugs.has(slugCandidate))
        takenSlugs.add(urlSlug)
        slugByRow.set(candidate.rowNumber, urlSlug)
    }

    return sequelize.transaction(async (transaction) => {
        const createdProducts: Product[] = []
        for (const candidate of candidates) {
            const { translations, ...rest } = candidate.input
            const product = await Product.create(
                { ...rest, urlSlug: slugByRow.get(candidate.rowNumber), imageUrl: null },
                { transaction }
            )
            if (translations?.en?.displayName) {
                await ProductTranslation.create(
                    { productId: product.id, language: "en", displayName: translations.en.displayName },
                    { transaction }
                )
            }
            createdProducts.push(product)
        }
        return createdProducts
    })
}

async function buildProductImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("Productos")
    sheet.columns = [
        { header: PRODUCT_IMPORT_COLUMNS.codigo.header, key: "codigo", width: 18 },
        { header: PRODUCT_IMPORT_COLUMNS.subCategory.header, key: "subCategory", width: 22 },
        { header: PRODUCT_IMPORT_COLUMNS.category.header, key: "category", width: 20 },
        { header: PRODUCT_IMPORT_COLUMNS.client.header, key: "client", width: 22 },
        { header: PRODUCT_IMPORT_COLUMNS.displayName.header, key: "displayName", width: 32 },
        { header: PRODUCT_IMPORT_COLUMNS.displayNameEn.header, key: "displayNameEn", width: 32 },
        { header: PRODUCT_IMPORT_COLUMNS.isOrganic.header, key: "isOrganic", width: 12 },
        { header: PRODUCT_IMPORT_COLUMNS.recipeType.header, key: "recipeType", width: 18 },
        { header: PRODUCT_IMPORT_COLUMNS.additionalCostPerUnit.header, key: "additionalCostPerUnit", width: 26 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({ codigo: "JUGO-PINA-WM", subCategory: "Jugos", client: "Walmart", displayName: "Jugo de piña", displayNameEn: "Pineapple juice", isOrganic: "No", recipeType: "Fija" })
    sheet.addRow({ codigo: "SMOOTHIE-MIX", subCategory: "Congelados", category: "Frutas", client: "Walmart", displayName: "Smoothie mix a la medida", isOrganic: "Sí", recipeType: "Personalizable", additionalCostPerUnit: 0.05 })

    const helpSheet = workbook.addWorksheet("Instrucciones")
    helpSheet.columns = [{ header: "Instrucciones", key: "help", width: 110 }]
    helpSheet.getRow(1).font = { bold: true }
    const helpLines = [
        "PASO 1 de 3: Productos → Recetas → SKUs. Una fila por Producto. Después carga su receta de materias primas (paso 2) y luego sus SKUs con empaque (paso 3).",
        `"${PRODUCT_IMPORT_COLUMNS.codigo.header}" es el SKU / número de artículo del producto: único (sin importar mayúsculas), no puede existir ya en el catálogo ni repetirse en este archivo.`,
        `"${PRODUCT_IMPORT_COLUMNS.subCategory.header}" debe ser el nombre EXACTO de una Subcategoría activa. Si hay dos Subcategorías con el mismo nombre en Categorías distintas, escribe también "${PRODUCT_IMPORT_COLUMNS.category.header}" para indicar cuál (si no, puedes dejarla vacía).`,
        `"${PRODUCT_IMPORT_COLUMNS.client.header}" debe ser el nombre EXACTO de un Cliente activo del catálogo de Clientes. Si dos Clientes activos se llaman igual, el archivo se rechaza: corrige el catálogo de Clientes primero.`,
        `"${PRODUCT_IMPORT_COLUMNS.recipeType.header}" es obligatorio: Fija (el porcentaje de cada materia prima lo fija el admin) o Personalizable (el representante arma la mezcla al cotizar).`,
        `"${PRODUCT_IMPORT_COLUMNS.isOrganic.header}": Sí o No (vacío = No). "${PRODUCT_IMPORT_COLUMNS.displayNameEn.header}" y "${PRODUCT_IMPORT_COLUMNS.additionalCostPerUnit.header}" son opcionales.`,
        "La imagen del producto NO se carga por Excel: el producto se crea sin imagen y la subes después desde su pantalla de edición.",
        "El archivo se valida COMPLETO antes de importar nada: si una sola fila tiene un error, no se crea ningún producto -- corrige el archivo y vuelve a subirlo. Este importador solo CREA productos nuevos, no actualiza los existentes.",
    ]
    helpLines.forEach(help => helpSheet.addRow({ help }))

    return writeWorkbookToBuffer(workbook)
}

export const productImportService = {
    bulkImportProducts,
    buildProductImportTemplate,
}
