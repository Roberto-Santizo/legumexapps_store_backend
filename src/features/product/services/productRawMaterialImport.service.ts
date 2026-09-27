import ExcelJS from "exceljs"
import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
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

// Carga masiva de Recetas (2026-09-25) -- paso 2 de 3 (Productos → Recetas → SKUs, ver CLAUDE.md
// #4). Una fila por (Producto, Materia Prima); las filas se agrupan por producto, igual que
// productVariantImport.service.ts::finalizeVariantGroup agrupa por SKU. Las reglas dependen del
// Product.isCustomizable ya guardado (el archivo nunca re-declara el tipo de receta):
//   - Fija: Porcentaje obligatorio en cada fila y el grupo debe sumar 100 (±0.5) -- más estricto
//     que el techo blando del admin, porque el archivo trae la receta COMPLETA.
//   - Personalizable: sin Porcentaje; % mínimo/% máximo opcionales; cada materia prima debe ser
//     mezclable, y el rango debe permitir llegar a 100 (Σmín ≤ 100 ≤ Σmáx, solo en el importador).
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
    productCodigo: string
    rawMaterialCode: string
    percentage: number | undefined
    minPercentage: number | undefined
    maxPercentage: number | undefined
}

function roundForMessage(value: number): number {
    return Math.round(value * 100) / 100
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

// Reglas que dependen del tipo de receta del producto -- mismas que productRawMaterial.service.ts
// (porcentaje obligatorio en receta fija, mezclable en personalizable, compatibilidad orgánica),
// más las propias del archivo (columna equivocada para el tipo, mín > máx).
function checkRecipeTypeRules(row: ResolvedRecipeRow, ctx: RowValidation): void {
    const { product, rawMaterial } = row
    const params = { productCodigo: row.productCodigo }

    if (product.isCustomizable) {
        if (row.percentage !== undefined) {
            ctx.rowIssues.push({ row: ctx.rowNumber, field: "percentage", key: "errors.bulk_import_percentage_on_customizable_recipe", params })
        }
        if (row.minPercentage !== undefined && row.maxPercentage !== undefined && row.minPercentage > row.maxPercentage) {
            ctx.rowIssues.push({
                row: ctx.rowNumber,
                field: "minPercentage",
                key: "errors.bulk_import_min_greater_than_max",
                params: { min: row.minPercentage, max: row.maxPercentage }
            })
        }
        if (!rawMaterial.isMixable) {
            ctx.rowIssues.push({ row: ctx.rowNumber, field: "rawMaterialId", key: "errors.raw_material_not_mixable", params: { rawMaterialId: row.rawMaterialCode } })
        }
    } else {
        if (row.percentage === undefined) {
            ctx.rowIssues.push({ row: ctx.rowNumber, field: "percentage", key: "errors.product_raw_material_percentage_required" })
        }
        if (row.minPercentage !== undefined || row.maxPercentage !== undefined) {
            ctx.rowIssues.push({ row: ctx.rowNumber, field: "minPercentage", key: "errors.bulk_import_min_max_on_fixed_recipe", params })
        }
    }

    if (product.isOrganic && !rawMaterial.isOrganic && rawMaterial.ingredientType !== "other") {
        ctx.rowIssues.push({
            row: ctx.rowNumber,
            field: "rawMaterialId",
            key: "errors.raw_material_not_organic_compatible",
            params: { rawMaterialId: row.rawMaterialCode }
        })
    }
}

function collectRowZodIssues(candidate: unknown, manuallyValidatedFields: Set<string>, rowNumber: number): RowIssue[] {
    const result = createProductRawMaterialSchema.safeParse(candidate)
    if (result.success) return []

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        // El refine mín ≤ máx del schema se reporta con su propia key clara en checkRecipeTypeRules.
        if (issue.code === "custom") continue
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push({ row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return issues
}

function processRecipeImportRow(
    row: ExcelJS.Row,
    rowNumber: number,
    columnIndexByField: Map<ProductRawMaterialImportField, number>,
    productsByNormalizedCodigo: Map<string, Product>,
    rawMaterialsByNormalizedCode: Map<string, RawMaterial>,
    productIdsWithRowIssues: Set<number>,
    rowIssues: RowIssue[]
): ResolvedRecipeRow | null {
    const read = (field: ProductRawMaterialImportField) => readImportCell(row, columnIndexByField.get(field))
    const rawProductCodigo = read("productCodigo")
    const rawMaterialCode = read("rawMaterialCode")

    const ctx: RowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }
    const product = resolveProductField(rawProductCodigo, productsByNormalizedCodigo, ctx)
    const rawMaterial = resolveRawMaterialField(rawMaterialCode, rawMaterialsByNormalizedCode, ctx)
    const percentage = parseOptionalNumber(read("percentage"))
    const minPercentage = parseOptionalNumber(read("minPercentage"))
    const maxPercentage = parseOptionalNumber(read("maxPercentage"))

    ctx.rowIssues.push(...collectRowZodIssues(
        { productId: product?.id, rawMaterialId: rawMaterial?.id, percentage, minPercentage, maxPercentage },
        ctx.manuallyValidatedFields,
        rowNumber
    ))

    if (product && rawMaterial && ctx.rowIssues.length === 0) {
        const resolved: ResolvedRecipeRow = {
            rowNumber,
            product,
            rawMaterial,
            productCodigo: String(rawProductCodigo).trim(),
            rawMaterialCode: String(rawMaterialCode).trim(),
            percentage,
            minPercentage,
            maxPercentage,
        }
        checkRecipeTypeRules(resolved, ctx)
        if (ctx.rowIssues.length === 0) return resolved
    }

    // Un producto con alguna fila inválida no pasa por las validaciones de grupo (suma 100,
    // rango alcanzable): su total saldría incompleto y sumaría un error engañoso encima del real.
    if (product) productIdsWithRowIssues.add(product.id)
    rowIssues.push(...ctx.rowIssues)
    return null
}

function checkFixedRecipeTotal(rows: ResolvedRecipeRow[], params: { productCodigo: string }, rowNumber: number, rowIssues: RowIssue[]): boolean {
    const total = rows.reduce((sum, row) => sum + (row.percentage ?? 0), 0)
    if (Math.abs(total - 100) <= RECIPE_PERCENTAGE_TOLERANCE) return true
    rowIssues.push({
        row: rowNumber,
        field: "percentage",
        key: "errors.bulk_import_fixed_recipe_total_invalid",
        params: { ...params, total: roundForMessage(total) }
    })
    return false
}

// Mismos defaults que quoteService al validar la mezcla del representante: sin mínimo = 0, sin
// máximo = 100. Si ni con todos los mínimos cabe en 100, o ni con todos los máximos llega a 100,
// ninguna mezcla válida puede existir -- el producto sería imposible de cotizar.
function checkCustomizablePoolReaches100(rows: ResolvedRecipeRow[], params: { productCodigo: string }, rowNumber: number, rowIssues: RowIssue[]): boolean {
    const minTotal = rows.reduce((sum, row) => sum + (row.minPercentage ?? 0), 0)
    const maxTotal = rows.reduce((sum, row) => sum + (row.maxPercentage ?? 100), 0)
    if (minTotal <= 100 + RECIPE_PERCENTAGE_TOLERANCE && maxTotal >= 100 - RECIPE_PERCENTAGE_TOLERANCE) return true
    rowIssues.push({
        row: rowNumber,
        field: "minPercentage",
        key: "errors.bulk_import_customizable_pool_cannot_reach_100",
        params: { ...params, minTotal: roundForMessage(minTotal), maxTotal: roundForMessage(maxTotal) }
    })
    return false
}

function finalizeRecipeGroup(rows: ResolvedRecipeRow[], productIdsWithExistingRecipe: Set<number>, rowIssues: RowIssue[]): boolean {
    const firstRow = rows[0]
    const params = { productCodigo: firstRow.productCodigo }

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

    return firstRow.product.isCustomizable
        ? checkCustomizablePoolReaches100(rows, params, firstRow.rowNumber, rowIssues)
        : checkFixedRecipeTotal(rows, params, firstRow.rowNumber, rowIssues)
}

async function loadProductsByNormalizedCodigo(): Promise<Map<string, Product>> {
    const products = await Product.findAll({ where: { isActive: true } })
    return new Map(products.map(product => [normalizeImportText(product.codigo), product]))
}

async function loadRawMaterialsByNormalizedCode(): Promise<Map<string, RawMaterial>> {
    const rawMaterials = await RawMaterial.findAll({ where: { isActive: true } })
    return new Map(rawMaterials.map(rawMaterial => [normalizeImportText(rawMaterial.code), rawMaterial]))
}

async function loadProductIdsWithExistingRecipe(): Promise<Set<number>> {
    const recipeRows = await ProductRawMaterial.findAll({ where: { isActive: true }, attributes: ["productId"] })
    return new Set(recipeRows.map(recipeRow => recipeRow.productId))
}

function validateRecipeImportHeaders(sheet: ExcelJS.Worksheet): Map<ProductRawMaterialImportField, number> {
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
    const workbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    const columnIndexByField = validateRecipeImportHeaders(sheet)

    if (sheet.rowCount - 1 > MAX_PRODUCT_RAW_MATERIAL_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PRODUCT_RAW_MATERIAL_IMPORT_ROWS })
    }

    const [productsByNormalizedCodigo, rawMaterialsByNormalizedCode, productIdsWithExistingRecipe] = await Promise.all([
        loadProductsByNormalizedCodigo(),
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
            row, rowNumber, columnIndexByField, productsByNormalizedCodigo, rawMaterialsByNormalizedCode, productIdsWithRowIssues, rowIssues
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
            percentage: row.product.isCustomizable ? null : row.percentage,
            minPercentage: row.product.isCustomizable ? (row.minPercentage ?? null) : null,
            maxPercentage: row.product.isCustomizable ? (row.maxPercentage ?? null) : null,
        })),
        { transaction }
    ))
}

async function buildProductRawMaterialImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("Recetas")
    sheet.columns = [
        { header: PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS.productCodigo.header, key: "productCodigo", width: 18 },
        { header: PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS.rawMaterialCode.header, key: "rawMaterialCode", width: 22 },
        { header: PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS.percentage.header, key: "percentage", width: 14 },
        { header: PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS.minPercentage.header, key: "minPercentage", width: 14 },
        { header: PRODUCT_RAW_MATERIAL_IMPORT_COLUMNS.maxPercentage.header, key: "maxPercentage", width: 14 },
    ]
    sheet.getRow(1).font = { bold: true }
    // Receta fija: solo Porcentaje, sumando 100.
    sheet.addRow({ productCodigo: "JUGO-PINA-WM", rawMaterialCode: "MP-PINA", percentage: 90 })
    sheet.addRow({ productCodigo: "JUGO-PINA-WM", rawMaterialCode: "MP-AGUA", percentage: 10 })
    // Receta personalizable: sin Porcentaje, rangos opcionales.
    sheet.addRow({ productCodigo: "SMOOTHIE-MIX", rawMaterialCode: "MP-FRESA", minPercentage: 20, maxPercentage: 80 })
    sheet.addRow({ productCodigo: "SMOOTHIE-MIX", rawMaterialCode: "MP-BANANO", minPercentage: 20, maxPercentage: 80 })
    sheet.addRow({ productCodigo: "SMOOTHIE-MIX", rawMaterialCode: "MP-MANGO" })

    const helpSheet = workbook.addWorksheet("Instrucciones")
    helpSheet.columns = [{ header: "Instrucciones", key: "help", width: 110 }]
    helpSheet.getRow(1).font = { bold: true }
    const helpLines = [
        "PASO 2 de 3: Productos → Recetas → SKUs. Una fila por cada materia prima de la receta de un producto -- si un producto lleva 3 materias primas, escribe 3 filas con el mismo \"Código Producto\".",
        "\"Código Producto\" debe ser el código de un Producto ya creado (paso 1). El tipo de receta (Fija o Personalizable) se toma de ese producto, no se vuelve a escribir acá.",
        "\"Código Materia Prima\" debe ser el código EXACTO de una materia prima activa del catálogo de Materias Primas.",
        "Receta FIJA: llena solo \"Porcentaje\" en cada fila (mayor a 0, máximo 100). Las filas del producto deben sumar exactamente 100%. Deja vacías \"% mínimo\" y \"% máximo\".",
        "Receta PERSONALIZABLE: deja vacío \"Porcentaje\" (la mezcla la arma el representante al cotizar). \"% mínimo\" y \"% máximo\" son opcionales (vacío = 0 y 100). Cada materia prima debe estar marcada como mezclable, y los rangos deben permitir llegar a 100% (la suma de los mínimos no puede pasar de 100 y la de los máximos debe llegar al menos a 100).",
        "Si el producto es orgánico, cada materia prima debe ser orgánica o de tipo \"otro\" (agua, sal, azúcar...).",
        "Solo CREA recetas: un producto que ya tiene receta se rechaza -- edítala desde la pantalla del producto. El archivo se valida COMPLETO antes de importar nada: si una sola fila tiene un error, no se crea ninguna receta.",
    ]
    helpLines.forEach(help => helpSheet.addRow({ help }))

    return writeWorkbookToBuffer(workbook)
}

export const productRawMaterialImportService = {
    bulkImportProductRawMaterials,
    buildProductRawMaterialImportTemplate,
}
