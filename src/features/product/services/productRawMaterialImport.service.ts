import type { ParsedWorkbook, ParsedRow, ParsedWorksheet } from "../../../shared/utils/parsedWorkbook"
import ExcelJS from "exceljs"
import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
import { loadProductsByVariantSku, skuCodeKey } from "./productSkuReference"
import ProductRawMaterial from "../models/ProductRawMaterial.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import { AppError, BulkImportError, RowIssue } from "../../../shared/errors/AppError"
import { createProductRawMaterialSchema } from "../schemas/productRawMaterial.schema"
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
    MAX_PRODUCT_RAW_MATERIAL_IMPORT_ROWS,
    PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS,
    ProductRawMaterialImportField,
    RECIPE_PERCENTAGE_TOLERANCE,
    REQUIRED_PRODUCT_RAW_MATERIAL_IMPORT_FIELDS,
} from "../constants/productRawMaterialImport.constant"

// Carga masiva de Recetas. Una fila por (Producto, Materia Prima); la referencia SKU resuelve al
// producto y las filas se agrupan por producto. Porcentaje obligatorio en cada fila y el grupo debe
// sumar 100 (±0.5) -- más estricto que el techo blando del admin, porque el archivo trae la receta COMPLETA.
// Create-only: un producto que ya tiene receta activa se rechaza (se edita en su pantalla).

type RowValidation = {
    rowNumber: number
    rowIssues: RowIssue[]
    manuallyValidatedFields: Set<string>
}

interface ResolvedRecipeRow {
    rowNumber: number
    product: Product
    rawMaterial: RawMaterial
    productSku: string
    rawMaterialCode: string
    percentage: number
}

function roundForMessage(value: number): number {
    return Math.round(value * 100) / 100
}

function parseOptionalNumber(value: ImportCellValue): number | undefined {
    if (value === null || String(value).trim() === "") return undefined
    return Number(value)
}

function resolveProductField(rawSku: ImportCellValue, productsByVariantSku: Map<string, Product>, ctx: RowValidation): Product | undefined {
    if (rawSku === null) return undefined
    ctx.manuallyValidatedFields.add("productId")
    const skuCode = String(rawSku).trim()
    const product = productsByVariantSku.get(skuCodeKey(skuCode))
    if (!product) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "productId", key: "errors.bulk_import_unknown_product_sku", params: { skuCode } })
        return undefined
    }
    return product
}

function resolveRawMaterialField(rawCode: ImportCellValue, rawMaterialsByNormalizedCode: Map<string, RawMaterial>, ctx: RowValidation): RawMaterial | undefined {
    if (rawCode === null) return undefined
    ctx.manuallyValidatedFields.add("rawMaterialId")
    const code = String(rawCode).trim()
    const rawMaterial = rawMaterialsByNormalizedCode.get(normalizeImportText(code))
    if (!rawMaterial) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "rawMaterialId", key: "errors.bulk_import_unknown_raw_material_code", params: { code } })
        return undefined
    }
    return rawMaterial
}

function collectRowZodIssues(candidate: unknown, manuallyValidatedFields: Set<string>, rowNumber: number): RowIssue[] {
    const result = createProductRawMaterialSchema.safeParse(candidate)
    if (result.success) return []

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push({ row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return issues
}

function processRecipeImportRow(
    row: ParsedRow,
    rowNumber: number,
    columnIndexByField: Map<ProductRawMaterialImportField, number>,
    productsByVariantSku: Map<string, Product>,
    rawMaterialsByNormalizedCode: Map<string, RawMaterial>,
    productIdsWithRowIssues: Set<number>,
    rowIssues: RowIssue[]
): ResolvedRecipeRow | null {
    const read = (field: ProductRawMaterialImportField) => readImportCell(row, columnIndexByField.get(field))
    const rawProductSku = read("productSku")
    const rawMaterialCode = read("rawMaterialCode")

    const ctx: RowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }
    const product = resolveProductField(rawProductSku, productsByVariantSku, ctx)
    const rawMaterial = resolveRawMaterialField(rawMaterialCode, rawMaterialsByNormalizedCode, ctx)
    const percentage = parseOptionalNumber(read("percentage"))
    if (percentage === undefined) {
        ctx.manuallyValidatedFields.add("percentage")
        ctx.rowIssues.push({ row: rowNumber, field: "percentage", key: "errors.product_raw_material_percentage_required" })
    }

    ctx.rowIssues.push(...collectRowZodIssues(
        { productId: product?.id, rawMaterialId: rawMaterial?.id, percentage },
        ctx.manuallyValidatedFields,
        rowNumber
    ))

    if (product && rawMaterial && percentage !== undefined && ctx.rowIssues.length === 0) {
        const resolved: ResolvedRecipeRow = {
            rowNumber,
            product,
            rawMaterial,
            productSku: String(rawProductSku).trim(),
            rawMaterialCode: String(rawMaterialCode).trim(),
            percentage,
        }
        return resolved
    }

    // Un producto con alguna fila inválida no pasa por la validación de grupo (suma 100): su total saldría incompleto y sumaría un error engañoso encima del real.
    if (product) productIdsWithRowIssues.add(product.id)
    rowIssues.push(...ctx.rowIssues)
    return null
}

function checkRecipeTotal(rows: ResolvedRecipeRow[], params: { productSku: string }, rowNumber: number, rowIssues: RowIssue[]): boolean {
    const total = rows.reduce((sum, row) => sum + row.percentage, 0)
    if (Math.abs(total - 100) <= RECIPE_PERCENTAGE_TOLERANCE) return true
    rowIssues.push({
        row: rowNumber,
        field: "percentage",
        key: "errors.bulk_import_fixed_recipe_total_invalid",
        params: { ...params, total: roundForMessage(total) }
    })
    return false
}

function finalizeRecipeGroup(rows: ResolvedRecipeRow[], productIdsWithExistingRecipe: Set<number>, rowIssues: RowIssue[]): boolean {
    const firstRow = rows[0]
    const params = { productSku: firstRow.productSku }

    if (productIdsWithExistingRecipe.has(firstRow.product.id)) {
        rowIssues.push({ row: firstRow.rowNumber, field: "productId", key: "errors.bulk_import_product_recipe_already_exists", params })
        return false
    }

    let isValid = true
    const seenRawMaterialIds = new Set<number>()
    for (const row of rows) {
        if (seenRawMaterialIds.has(row.rawMaterial.id)) {
            rowIssues.push({
                row: row.rowNumber,
                field: "rawMaterialId",
                key: "errors.bulk_import_duplicate_raw_material_in_product",
                params: { ...params, code: row.rawMaterialCode }
            })
            isValid = false
        }
        seenRawMaterialIds.add(row.rawMaterial.id)
    }
    if (!isValid) return false

    return checkRecipeTotal(rows, params, firstRow.rowNumber, rowIssues)
}



async function loadRawMaterialsByNormalizedCode(): Promise<Map<string, RawMaterial>> {
    const rawMaterials = await RawMaterial.findAll({ where: { isActive: true } })
    return new Map(rawMaterials.map(rawMaterial => [normalizeImportText(rawMaterial.code), rawMaterial]))
}

async function loadProductIdsWithExistingRecipe(): Promise<Set<number>> {
    const recipeRows = await ProductRawMaterial.findAll({ where: { isActive: true }, attributes: ["productId"] })
    return new Set(recipeRows.map(recipeRow => recipeRow.productId))
}

function validateRecipeImportHeaders(sheet: ParsedWorksheet): Map<ProductRawMaterialImportField, number> {
    const columnIndexByField = mapImportHeaders(sheet.getRow(1), PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS)
    const missingFields = REQUIRED_PRODUCT_RAW_MATERIAL_IMPORT_FIELDS.filter(field => !columnIndexByField.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS[field].header).join(", ")
        })
    }
    return columnIndexByField
}

async function bulkImportProductRawMaterials(buffer: Buffer): Promise<ProductRawMaterial[]> {
    const workbook: ParsedWorkbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    const columnIndexByField = validateRecipeImportHeaders(sheet)

    if (sheet.rowCount - 1 > MAX_PRODUCT_RAW_MATERIAL_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PRODUCT_RAW_MATERIAL_IMPORT_ROWS })
    }

    const [productsByVariantSku, rawMaterialsByNormalizedCode, productIdsWithExistingRecipe] = await Promise.all([
        loadProductsByVariantSku(),
        loadRawMaterialsByNormalizedCode(),
        loadProductIdsWithExistingRecipe(),
    ])

    const rowIssues: RowIssue[] = []
    const productIdsWithRowIssues = new Set<number>()
    const rowsByProductId = new Map<number, ResolvedRecipeRow[]>()

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const resolved = processRecipeImportRow(
            row, rowNumber, columnIndexByField, productsByVariantSku, rawMaterialsByNormalizedCode, productIdsWithRowIssues, rowIssues
        )
        if (!resolved) continue
        const bucket = rowsByProductId.get(resolved.product.id) ?? []
        bucket.push(resolved)
        rowsByProductId.set(resolved.product.id, bucket)
    }

    const validRows: ResolvedRecipeRow[] = []
    for (const [productId, rows] of rowsByProductId) {
        if (productIdsWithRowIssues.has(productId)) continue
        if (finalizeRecipeGroup(rows, productIdsWithExistingRecipe, rowIssues)) validRows.push(...rows)
    }

    if (rowIssues.length > 0) {
        throw new BulkImportError(rowIssues)
    }
    if (validRows.length === 0) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    return sequelize.transaction(async (transaction) => ProductRawMaterial.bulkCreate(
        validRows.map(row => ({
            productId: row.product.id,
            rawMaterialId: row.rawMaterial.id,
            percentage: row.percentage,
        })),
        { transaction }
    ))
}

async function buildProductRawMaterialImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("Recetas")
    sheet.columns = [
        { header: PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS.productSku.header, key: "productSku", width: 18 },
        { header: PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS.rawMaterialCode.header, key: "rawMaterialCode", width: 22 },
        { header: PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS.percentage.header, key: "percentage", width: 14 },
    ]
    sheet.getRow(1).font = { bold: true }
    // Las filas de un producto suman 100.
    sheet.addRow({ productSku: "JUGO-PINA-WM", rawMaterialCode: "MP-PINA", percentage: 90 })
    sheet.addRow({ productSku: "JUGO-PINA-WM", rawMaterialCode: "MP-AGUA", percentage: 10 })

    const helpSheet = workbook.addWorksheet("Instrucciones")
    helpSheet.columns = [{ header: "Instrucciones", key: "help", width: 110 }]
    helpSheet.getRow(1).font = { bold: true }
    const helpLines = [
        "PASO 2 de 3: Productos y SKUs → Recetas → Ingredientes (opcional). Una fila por cada materia prima de la receta de un producto -- si un producto lleva 3 materias primas, escribe 3 filas con el mismo \"SKU de una variante del producto\".",
        "\"SKU de una variante del producto\" debe ser el SKU de una variante activa de un producto activo ya creado (paso 1).",
        "\"Código Materia Prima\" debe ser el código EXACTO de una materia prima activa del catálogo de Materias Primas.",
        "\"Porcentaje\" es obligatorio en cada fila (mayor a 0, máximo 100). Las filas del producto deben sumar exactamente 100%.",
        "Si el producto es orgánico, cada materia prima debe ser orgánica o de tipo \"otro\" (agua, sal, azúcar...).",
        "Solo CREA recetas: un producto que ya tiene receta se rechaza -- edítala desde la pantalla del producto. El archivo se valida COMPLETO antes de importar nada: si una sola fila tiene un error, no se crea ninguna receta.",
        "Los SKUs distintos del mismo producto se agrupan por producto. No repitas una receta completa ni el mismo material/ingrediente usando otro SKU: se rechaza como duplicado del producto.",
    ]
    helpLines.forEach(help => helpSheet.addRow({ help }))

    return writeWorkbookToBuffer(workbook)
}

export const productRawMaterialImportService = {
    bulkImportProductRawMaterials,
    buildProductRawMaterialImportTemplate,
}
