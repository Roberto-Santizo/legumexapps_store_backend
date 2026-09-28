import ExcelJS from "exceljs"
import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
import ProductIngredient from "../models/ProductIngredient.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import { AppError, BulkImportError, RowIssue } from "../../../shared/errors/AppError"
import { createProductIngredientSchema } from "../schemas/productIngredient.schema"
import {
    ImportCellValue,
    isImportRowBlank,
    loadWorkbookFromBuffer,
    mapImportHeaders,
    normalizeImportText,
    readImportCell,
    writeWorkbookToBuffer,
} from "../../../shared/utils/excelImport.util"
import {
    MAX_PRODUCT_INGREDIENT_IMPORT_ROWS,
    PRODUCT_INGREDIENT_IMPORT_COLUMNS,
    ProductIngredientImportField,
    REQUIRED_PRODUCT_INGREDIENT_IMPORT_FIELDS,
} from "../constants/productIngredientImport.constant"

// Carga masiva de Ingredientes por producto -- paso 3 (opcional) de 4 (Productos → Recetas →
// Ingredientes → SKUs). Una fila por (Producto, Ingrediente), agrupadas por
// producto igual que productRawMaterialImport.service.ts. Sin regla de 100% (los ingredientes van
// encima de la receta base) y mismas reglas para receta fija y personalizable:
//   - producto e ingrediente existen y están activos;
//   - Gramos ≤ Peso de referencia (mismo guard que productIngredient.service.ts);
//   - el mismo ingrediente no se repite dentro de un producto;
//   - create-only: un producto que ya tiene algún ingrediente activo se rechaza.
// Todo o nada, en una sola transacción. Los SKUs (paso 4) no dependen de este paso.

type RowValidation = {
    rowNumber: number
    rowIssues: RowIssue[]
    manuallyValidatedFields: Set<string>
}

interface ResolvedIngredientRow {
    rowNumber: number
    product: Product
    ingredient: Ingredient
    productCodigo: string
    ingredientCode: string
    grams: number
    referenceNetWeightGrams: number
}

function parseOptionalNumber(value: ImportCellValue): number | undefined {
    if (value === null || String(value).trim() === "") return undefined
    return Number(value)
}

function resolveProductField(rawCodigo: ImportCellValue, productsByNormalizedCodigo: Map<string, Product>, ctx: RowValidation): Product | undefined {
    if (rawCodigo === null) return undefined
    ctx.manuallyValidatedFields.add("productId")
    const codigo = String(rawCodigo).trim()
    const product = productsByNormalizedCodigo.get(normalizeImportText(codigo))
    if (!product) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "productId", key: "errors.bulk_import_unknown_product_codigo", params: { codigo } })
        return undefined
    }
    return product
}

function resolveIngredientField(rawCode: ImportCellValue, ingredientsByNormalizedCode: Map<string, Ingredient>, ctx: RowValidation): Ingredient | undefined {
    if (rawCode === null) return undefined
    ctx.manuallyValidatedFields.add("ingredientId")
    const code = String(rawCode).trim()
    const ingredient = ingredientsByNormalizedCode.get(normalizeImportText(code))
    if (!ingredient) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "ingredientId", key: "errors.bulk_import_unknown_ingredient_code", params: { code } })
        return undefined
    }
    return ingredient
}

function collectRowZodIssues(candidate: unknown, manuallyValidatedFields: Set<string>, rowNumber: number): RowIssue[] {
    const result = createProductIngredientSchema.safeParse(candidate)
    if (result.success) return []

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push({ row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return issues
}

function processIngredientImportRow(
    row: ExcelJS.Row,
    rowNumber: number,
    columnIndexByField: Map<ProductIngredientImportField, number>,
    productsByNormalizedCodigo: Map<string, Product>,
    ingredientsByNormalizedCode: Map<string, Ingredient>,
    rowIssues: RowIssue[]
): ResolvedIngredientRow | null {
    const read = (field: ProductIngredientImportField) => readImportCell(row, columnIndexByField.get(field))
    const rawProductCodigo = read("productCodigo")
    const rawIngredientCode = read("ingredientCode")

    const ctx: RowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }
    const product = resolveProductField(rawProductCodigo, productsByNormalizedCodigo, ctx)
    const ingredient = resolveIngredientField(rawIngredientCode, ingredientsByNormalizedCode, ctx)
    const grams = parseOptionalNumber(read("grams"))
    const referenceNetWeightGrams = parseOptionalNumber(read("referenceNetWeightGrams"))

    ctx.rowIssues.push(...collectRowZodIssues(
        { productId: product?.id, ingredientId: ingredient?.id, grams, referenceNetWeightGrams },
        ctx.manuallyValidatedFields,
        rowNumber
    ))

    if (ctx.rowIssues.length === 0 && grams !== undefined && referenceNetWeightGrams !== undefined && grams > referenceNetWeightGrams) {
        ctx.rowIssues.push({
            row: rowNumber,
            field: "grams",
            key: "errors.product_ingredient_grams_exceed_reference",
            params: { grams, referenceNetWeightGrams }
        })
    }

    if (product && ingredient && ctx.rowIssues.length === 0) {
        return {
            rowNumber,
            product,
            ingredient,
            productCodigo: String(rawProductCodigo).trim(),
            ingredientCode: String(rawIngredientCode).trim(),
            grams: grams as number,
            referenceNetWeightGrams: referenceNetWeightGrams as number,
        }
    }

    rowIssues.push(...ctx.rowIssues)
    return null
}

function finalizeProductGroup(rows: ResolvedIngredientRow[], productIdsWithExistingIngredients: Set<number>, rowIssues: RowIssue[]): boolean {
    const firstRow = rows[0]
    const params = { productCodigo: firstRow.productCodigo }

    if (productIdsWithExistingIngredients.has(firstRow.product.id)) {
        rowIssues.push({ row: firstRow.rowNumber, field: "productId", key: "errors.bulk_import_product_ingredients_already_exist", params })
        return false
    }

    let isValid = true
    const seenIngredientIds = new Set<number>()
    for (const row of rows) {
        if (seenIngredientIds.has(row.ingredient.id)) {
            rowIssues.push({
                row: row.rowNumber,
                field: "ingredientId",
                key: "errors.bulk_import_duplicate_ingredient_in_product",
                params: { ...params, code: row.ingredientCode }
            })
            isValid = false
        }
        seenIngredientIds.add(row.ingredient.id)
    }
    return isValid
}

async function loadProductsByNormalizedCodigo(): Promise<Map<string, Product>> {
    const products = await Product.findAll({ where: { isActive: true } })
    return new Map(products.map(product => [normalizeImportText(product.codigo), product]))
}

async function loadIngredientsByNormalizedCode(): Promise<Map<string, Ingredient>> {
    const ingredients = await Ingredient.findAll({ where: { isActive: true } })
    return new Map(ingredients.map(ingredient => [normalizeImportText(ingredient.code), ingredient]))
}

async function loadProductIdsWithExistingIngredients(): Promise<Set<number>> {
    const ingredientRows = await ProductIngredient.findAll({ where: { isActive: true }, attributes: ["productId"] })
    return new Set(ingredientRows.map(ingredientRow => ingredientRow.productId))
}

function validateIngredientImportHeaders(sheet: ExcelJS.Worksheet): Map<ProductIngredientImportField, number> {
    const columnIndexByField = mapImportHeaders(sheet.getRow(1), PRODUCT_INGREDIENT_IMPORT_COLUMNS)
    const missingFields = REQUIRED_PRODUCT_INGREDIENT_IMPORT_FIELDS.filter(field => !columnIndexByField.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => PRODUCT_INGREDIENT_IMPORT_COLUMNS[field].header).join(", ")
        })
    }
    return columnIndexByField
}

async function bulkImportProductIngredients(buffer: Buffer): Promise<ProductIngredient[]> {
    const workbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    const columnIndexByField = validateIngredientImportHeaders(sheet)

    if (sheet.rowCount - 1 > MAX_PRODUCT_INGREDIENT_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PRODUCT_INGREDIENT_IMPORT_ROWS })
    }

    const [productsByNormalizedCodigo, ingredientsByNormalizedCode, productIdsWithExistingIngredients] = await Promise.all([
        loadProductsByNormalizedCodigo(),
        loadIngredientsByNormalizedCode(),
        loadProductIdsWithExistingIngredients(),
    ])

    const rowIssues: RowIssue[] = []
    const rowsByProductId = new Map<number, ResolvedIngredientRow[]>()

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const resolved = processIngredientImportRow(
            row, rowNumber, columnIndexByField, productsByNormalizedCodigo, ingredientsByNormalizedCode, rowIssues
        )
        if (!resolved) continue
        const bucket = rowsByProductId.get(resolved.product.id) ?? []
        bucket.push(resolved)
        rowsByProductId.set(resolved.product.id, bucket)
    }

    const validRows: ResolvedIngredientRow[] = []
    for (const rows of rowsByProductId.values()) {
        if (finalizeProductGroup(rows, productIdsWithExistingIngredients, rowIssues)) validRows.push(...rows)
    }

    if (rowIssues.length > 0) {
        throw new BulkImportError(rowIssues)
    }
    if (validRows.length === 0) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    return sequelize.transaction(async (transaction) => ProductIngredient.bulkCreate(
        validRows.map(row => ({
            productId: row.product.id,
            ingredientId: row.ingredient.id,
            grams: row.grams,
            referenceNetWeightGrams: row.referenceNetWeightGrams,
        })),
        { transaction }
    ))
}

async function buildProductIngredientImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("Ingredientes")
    sheet.columns = [
        { header: PRODUCT_INGREDIENT_IMPORT_COLUMNS.productCodigo.header, key: "productCodigo", width: 18 },
        { header: PRODUCT_INGREDIENT_IMPORT_COLUMNS.ingredientCode.header, key: "ingredientCode", width: 22 },
        { header: PRODUCT_INGREDIENT_IMPORT_COLUMNS.grams.header, key: "grams", width: 12 },
        { header: PRODUCT_INGREDIENT_IMPORT_COLUMNS.referenceNetWeightGrams.header, key: "referenceNetWeightGrams", width: 24 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({ productCodigo: "MANGO-DESH", ingredientCode: "SAL-001", grams: 40, referenceNetWeightGrams: 2000 })
    sheet.addRow({ productCodigo: "MANGO-DESH", ingredientCode: "AZU-001", grams: 100, referenceNetWeightGrams: 2000 })
    sheet.addRow({ productCodigo: "SMOOTHIE-MIX", ingredientCode: "AZU-001", grams: 12.5, referenceNetWeightGrams: 500 })

    const helpSheet = workbook.addWorksheet("Instrucciones")
    helpSheet.columns = [{ header: "Instrucciones", key: "help", width: 110 }]
    helpSheet.getRow(1).font = { bold: true }
    const helpLines = [
        "PASO 3 de 4 (OPCIONAL): Productos → Recetas → Ingredientes → SKUs. Una fila por cada ingrediente agregado a un producto (sal, azúcar, pimienta...). Los productos sin ingredientes simplemente no aparecen en este archivo.",
        "\"Código Producto\" debe ser el código de un Producto ya creado (paso 1). \"Código Ingrediente\" debe ser el código EXACTO de un ingrediente activo del catálogo de Ingredientes.",
        "\"Gramos\" son los gramos del ingrediente en una presentación de \"Peso de referencia (g)\" -- ej. 40 g de sal en una presentación de 2000 g. El costo escala solo con cada presentación que se cotice (en una de 500 g serían 10 g).",
        "Los gramos no pueden ser mayores que el peso de referencia. Los ingredientes NO forman parte del 100% de la receta: se cobran aparte, encima de la receta base.",
        "Solo CREA ingredientes: un producto que ya tiene ingredientes se rechaza -- edítalos desde la pantalla del producto. El archivo se valida COMPLETO antes de importar nada: si una sola fila tiene un error, no se crea ninguno.",
    ]
    helpLines.forEach(help => helpSheet.addRow({ help }))

    return writeWorkbookToBuffer(workbook)
}

export const productIngredientImportService = {
    bulkImportProductIngredients,
    buildProductIngredientImportTemplate,
}
