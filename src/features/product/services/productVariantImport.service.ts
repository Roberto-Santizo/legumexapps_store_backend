import ExcelJS from "exceljs"
import { z } from "zod"
import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
import Presentation from "../../presentation/models/Presentation.model"
import Packaging from "../../packaging/models/Packaging.model"
import ProductVariant from "../models/ProductVariant.model"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { AppError, BulkImportError, RowIssue } from "../../../shared/errors/AppError"
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
    MAX_PRODUCT_VARIANT_IMPORT_ROWS,
    PRODUCT_VARIANT_IMPORT_COLUMNS,
    ProductVariantImportField,
    REQUIRED_PRODUCT_VARIANT_IMPORT_FIELDS,
} from "../constants/productVariantImport.constant"

// Forma de una fila YA resuelta (códigos/nombres de texto cambiados por sus ids reales) pero
// TODAVÍA sin las validaciones cruzadas de todo el grupo (ver finalizeSkuGroup) -- equivalente,
// a nivel de fila, a lo que create/updateProductVariantSchema exige a nivel de entidad, más los
// 2 campos que solo existen en esta plantilla (packagingId/quantity, van a una tabla hija).
const productVariantImportRowSchema = z.object({
    productId: z.number().int().positive(),
    skuCode: z.string().trim().min(1).max(60),
    presentationId: z.number().int().positive(),
    boxesPerPallet: z.number().int().positive(),
    bagsPerBox: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    quantity: z.number().positive(),
})
type ProductVariantImportRowInput = z.infer<typeof productVariantImportRowSchema>

interface ResolvedRow extends ProductVariantImportRowInput {
    rowNumber: number
    packagingRole: string
    packagingDisplayName: string
}

interface SkuImportCandidate {
    skuCode: string
    productId: number
    presentationId: number
    boxesPerPallet: number
    bagsPerBox: number
    intermediatePackagingId: number | null
    unitsPerIntermediatePackage: number | null
    unitMaterials: { packagingId: number; quantityPerUnit: number }[]
    palletMaterials: { packagingId: number; quantityValue: number }[]
}

type RowValidation = {
    rowNumber: number
    rowIssues: RowIssue[]
    manuallyValidatedFields: Set<string>
}

function resolveProductField(
    rawCodigo: ImportCellValue,
    productsByNormalizedCodigo: Map<string, Product>,
    ctx: RowValidation
): number | undefined {
    if (rawCodigo === null) return undefined
    ctx.manuallyValidatedFields.add("productId")
    const codigo = String(rawCodigo).trim()
    const product = productsByNormalizedCodigo.get(normalizeImportText(codigo))
    if (!product) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "productId", key: "errors.bulk_import_unknown_product_codigo", params: { codigo } })
        return undefined
    }
    return product.id
}

function resolvePresentationField(
    rawLabel: ImportCellValue,
    presentationsByNormalizedLabel: Map<string, Presentation[]>,
    ctx: RowValidation
): number | undefined {
    if (rawLabel === null) return undefined
    ctx.manuallyValidatedFields.add("presentationId")
    const label = String(rawLabel).trim()
    const matches = presentationsByNormalizedLabel.get(normalizeImportText(label)) ?? []
    if (matches.length === 0) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "presentationId", key: "errors.bulk_import_presentation_not_found", params: { value: label } })
        return undefined
    }
    if (matches.length > 1) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "presentationId", key: "errors.bulk_import_presentation_ambiguous", params: { value: label } })
        return undefined
    }
    return matches[0].id
}

function resolveMaterialField(
    rawCode: ImportCellValue,
    packagingsByNormalizedCode: Map<string, Packaging>,
    ctx: RowValidation
): Packaging | undefined {
    if (rawCode === null) return undefined
    ctx.manuallyValidatedFields.add("packagingId")
    const code = String(rawCode).trim()
    const packaging = packagingsByNormalizedCode.get(normalizeImportText(code))
    if (!packaging) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "packagingId", key: "errors.bulk_import_unknown_packaging_code", params: { code } })
        return undefined
    }
    return packaging
}

function collectRowZodIssues(
    candidate: unknown,
    manuallyValidatedFields: Set<string>,
    rowNumber: number
): { validated?: ProductVariantImportRowInput; issues: RowIssue[] } {
    const result = productVariantImportRowSchema.safeParse(candidate)
    if (result.success) return { validated: result.data, issues: [] }

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push({ row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return { issues }
}

function processProductVariantImportRow(
    row: ExcelJS.Row,
    rowNumber: number,
    columnIndexByField: Map<ProductVariantImportField, number>,
    productsByNormalizedCodigo: Map<string, Product>,
    presentationsByNormalizedLabel: Map<string, Presentation[]>,
    packagingsByNormalizedCode: Map<string, Packaging>,
    rowIssues: RowIssue[]
): ResolvedRow | null {
    const rawProductCodigo = readImportCell(row, columnIndexByField.get("productCodigo"))
    const rawSkuCode = readImportCell(row, columnIndexByField.get("skuCode"))
    const rawPresentationLabel = readImportCell(row, columnIndexByField.get("presentationLabel"))
    const rawBoxesPerPallet = readImportCell(row, columnIndexByField.get("boxesPerPallet"))
    const rawBagsPerBox = readImportCell(row, columnIndexByField.get("bagsPerBox"))
    const rawMaterialCode = readImportCell(row, columnIndexByField.get("materialCode"))
    const rawQuantity = readImportCell(row, columnIndexByField.get("quantity"))

    const ctx: RowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }

    const productId = resolveProductField(rawProductCodigo, productsByNormalizedCodigo, ctx)
    const presentationId = resolvePresentationField(rawPresentationLabel, presentationsByNormalizedLabel, ctx)
    const packaging = resolveMaterialField(rawMaterialCode, packagingsByNormalizedCode, ctx)

    const candidate = {
        productId,
        skuCode: rawSkuCode === null ? rawSkuCode : String(rawSkuCode).trim(),
        presentationId,
        boxesPerPallet: rawBoxesPerPallet === null || rawBoxesPerPallet === "" ? undefined : Number(rawBoxesPerPallet),
        bagsPerBox: rawBagsPerBox === null || rawBagsPerBox === "" ? undefined : Number(rawBagsPerBox),
        packagingId: packaging?.id,
        quantity: rawQuantity === null || rawQuantity === "" ? undefined : Number(rawQuantity),
    }

    const { validated, issues: zodIssues } = collectRowZodIssues(candidate, ctx.manuallyValidatedFields, rowNumber)
    ctx.rowIssues.push(...zodIssues)

    if (ctx.rowIssues.length > 0) {
        rowIssues.push(...ctx.rowIssues)
        return null
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- rowIssues vacío arriba garantiza que zod sí validó, y packaging se resolvió (mismo campo que packagingId)
    return { ...validated!, rowNumber, packagingRole: packaging!.packagingRole, packagingDisplayName: packaging!.displayName }
}

// Todas las validaciones que solo tienen sentido mirando el GRUPO completo de filas de un mismo
// SKU (no una fila aislada): consistencia de los campos que se repiten en cada fila, cuántos
// materiales de cada rol trae, y si el propio código SKU ya existe. Devuelve null (con sus
// RowIssue ya cargados) si el grupo no puede importarse tal cual está.
function finalizeSkuGroup(rows: ResolvedRow[], existingSkuCodesByNormalized: Set<string>, rowIssues: RowIssue[]): SkuImportCandidate | null {
    const firstRow = rows[0]
    const skuCode = firstRow.skuCode
    let hasIssue = false

    if (existingSkuCodesByNormalized.has(normalizeImportText(skuCode))) {
        rowIssues.push({ row: firstRow.rowNumber, field: "skuCode", key: "errors.product_variant_skucode_already_exists", params: { skuCode } })
        hasIssue = true
    }

    // Los campos "de encabezado" (Código Producto/Presentación/Cajas por palet/Bolsas por caja) se
    // repiten en cada fila de material del mismo SKU, igual que en los 3 Excel de origen del
    // negocio -- si alguna fila trae un valor distinto a las demás para el MISMO SKU, es una
    // contradicción de tipeo, no un dato válido: se rechaza el archivo entero en vez de adivinar
    // cuál fila tiene razón.
    const isInconsistent = rows.some(row =>
        row.productId !== firstRow.productId ||
        row.presentationId !== firstRow.presentationId ||
        row.boxesPerPallet !== firstRow.boxesPerPallet ||
        row.bagsPerBox !== firstRow.bagsPerBox
    )
    if (isInconsistent) {
        rowIssues.push({ row: firstRow.rowNumber, field: "skuCode", key: "errors.bulk_import_sku_inconsistent_fields", params: { skuCode } })
        hasIssue = true
    }

    // El mismo material no puede aparecer 2 veces para el mismo SKU en el rol unit/pallet -- ambas
    // tablas hijas tienen un índice único (productVariantId, packagingId) (ver
    // ProductVariantUnitMaterial.model.ts / ProductVariantPalletMaterial.model.ts); detectarlo acá
    // da un error claro en vez de dejar que la transacción reviente más abajo.
    const seenPackagingIds = new Set<number>()
    for (const row of rows) {
        if (row.packagingRole === "intermediate") continue
        if (seenPackagingIds.has(row.packagingId)) {
            rowIssues.push({
                row: row.rowNumber,
                field: "materialCode",
                key: "errors.bulk_import_duplicate_material_in_sku",
                params: { skuCode, code: row.packagingDisplayName }
            })
            hasIssue = true
        }
        seenPackagingIds.add(row.packagingId)
    }

    const intermediateRows = rows.filter(row => row.packagingRole === "intermediate")
    if (intermediateRows.length > 1) {
        rowIssues.push({ row: firstRow.rowNumber, field: "materialCode", key: "errors.bulk_import_multiple_intermediate_rows", params: { skuCode } })
        hasIssue = true
    }

    const unitRows = rows.filter(row => row.packagingRole === "unit")
    const palletRows = rows.filter(row => row.packagingRole === "pallet")
    if (unitRows.length === 0) {
        rowIssues.push({ row: firstRow.rowNumber, field: "materialCode", key: "errors.bulk_import_sku_missing_unit_materials", params: { skuCode } })
        hasIssue = true
    }
    if (palletRows.length === 0) {
        rowIssues.push({ row: firstRow.rowNumber, field: "materialCode", key: "errors.bulk_import_sku_missing_pallet_materials", params: { skuCode } })
        hasIssue = true
    }

    if (hasIssue) return null

    const intermediateRow = intermediateRows[0]
    return {
        skuCode,
        productId: firstRow.productId,
        presentationId: firstRow.presentationId,
        boxesPerPallet: firstRow.boxesPerPallet,
        bagsPerBox: firstRow.bagsPerBox,
        intermediatePackagingId: intermediateRow ? intermediateRow.packagingId : null,
        unitsPerIntermediatePackage: intermediateRow ? intermediateRow.quantity : null,
        unitMaterials: unitRows.map(row => ({ packagingId: row.packagingId, quantityPerUnit: row.quantity })),
        palletMaterials: palletRows.map(row => ({ packagingId: row.packagingId, quantityValue: row.quantity })),
    }
}

async function loadProductsByNormalizedCodigo(): Promise<Map<string, Product>> {
    const products = await Product.findAll({ where: { isActive: true } })
    return new Map(products.map(product => [normalizeImportText(product.codigo), product]))
}

async function loadPresentationsByNormalizedLabel(): Promise<Map<string, Presentation[]>> {
    const presentations = await Presentation.findAll({ where: { isActive: true } })
    const byLabel = new Map<string, Presentation[]>()
    for (const presentation of presentations) {
        const key = normalizeImportText(presentation.displayLabel)
        const bucket = byLabel.get(key) ?? []
        bucket.push(presentation)
        byLabel.set(key, bucket)
    }
    return byLabel
}

async function loadPackagingsByNormalizedCode(): Promise<Map<string, Packaging>> {
    const packagings = await Packaging.findAll({ where: { isActive: true } })
    return new Map(packagings.map(packaging => [normalizeImportText(packaging.code), packaging]))
}

// A diferencia de loadExistingPackagingCodes/loadExistingIngredientCodes (que sí filtran por
// código porque ES el único identificador de esas filas), acá se cargan TODOS los skuCode
// existentes (activos o no, mismo criterio) para detectar colisiones contra la BD antes de
// intentar escribir nada.
async function loadExistingSkuCodes(): Promise<Set<string>> {
    const existingVariants = await ProductVariant.findAll({ attributes: ["skuCode"] })
    return new Set(
        existingVariants
            .map(variant => variant.skuCode)
            .filter((skuCode): skuCode is string => !!skuCode)
            .map(skuCode => normalizeImportText(skuCode))
    )
}

function validateProductVariantImportHeaders(sheet: ExcelJS.Worksheet): Map<ProductVariantImportField, number> {
    const columnIndexByField = mapImportHeaders(sheet.getRow(1), PRODUCT_VARIANT_IMPORT_COLUMNS)
    const missingFields = REQUIRED_PRODUCT_VARIANT_IMPORT_FIELDS.filter(field => !columnIndexByField.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => PRODUCT_VARIANT_IMPORT_COLUMNS[field].header).join(", ")
        })
    }
    return columnIndexByField
}

// Todo o nada POR ARCHIVO (2026-09-13, a pedido explícito del usuario -- distinto del resto de
// importadores de este repo, que hacen un único `bulkCreate` plano de una tabla al final). Acá se
// escribe en 3 tablas por SKU (ProductVariant + sus materiales unit/pallet, más
// intermediatePackagingId/unitsPerIntermediatePackage cuando aplica), así que "nada se escribe a
// menos que TODO el archivo sea válido" se logra en dos fases: (1) validar TODO en memoria, sin
// tocar la BD para escribir nada -- solo lecturas; (2) recién si no hay ningún RowIssue, abrir UNA
// transacción que crea todos los SKUs -- si algo inesperado revienta a mitad de la fase 2 (ej. una
// violación de constraint que la fase 1 no anticipó), la transacción entera hace rollback y no
// queda ninguna variante a medio crear.
async function bulkImportProductVariants(buffer: Buffer): Promise<ProductVariant[]> {
    const workbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    const columnIndexByField = validateProductVariantImportHeaders(sheet)

    if (sheet.rowCount - 1 > MAX_PRODUCT_VARIANT_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PRODUCT_VARIANT_IMPORT_ROWS })
    }

    const [productsByNormalizedCodigo, presentationsByNormalizedLabel, packagingsByNormalizedCode, existingSkuCodesByNormalized] = await Promise.all([
        loadProductsByNormalizedCodigo(),
        loadPresentationsByNormalizedLabel(),
        loadPackagingsByNormalizedCode(),
        loadExistingSkuCodes(),
    ])

    const rowIssues: RowIssue[] = []
    const resolvedRows: ResolvedRow[] = []

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const resolvedRow = processProductVariantImportRow(
            row, rowNumber, columnIndexByField, productsByNormalizedCodigo, presentationsByNormalizedLabel, packagingsByNormalizedCode, rowIssues
        )
        if (resolvedRow) resolvedRows.push(resolvedRow)
    }

    const rowsBySkuCode = new Map<string, ResolvedRow[]>()
    for (const row of resolvedRows) {
        const key = normalizeImportText(row.skuCode)
        const bucket = rowsBySkuCode.get(key) ?? []
        bucket.push(row)
        rowsBySkuCode.set(key, bucket)
    }

    const candidates: SkuImportCandidate[] = []
    for (const rows of rowsBySkuCode.values()) {
        const candidate = finalizeSkuGroup(rows, existingSkuCodesByNormalized, rowIssues)
        if (candidate) candidates.push(candidate)
    }

    if (rowIssues.length > 0) {
        throw new BulkImportError(rowIssues)
    }
    if (candidates.length === 0) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    return sequelize.transaction(async (transaction) => {
        const createdVariants: ProductVariant[] = []
        for (const candidate of candidates) {
            const variant = await ProductVariant.create(
                {
                    productId: candidate.productId,
                    presentationId: candidate.presentationId,
                    skuCode: candidate.skuCode,
                    boxesPerPallet: candidate.boxesPerPallet,
                    bagsPerBox: candidate.bagsPerBox,
                    intermediatePackagingId: candidate.intermediatePackagingId,
                    unitsPerIntermediatePackage: candidate.unitsPerIntermediatePackage,
                },
                { transaction }
            )

            await ProductVariantUnitMaterial.bulkCreate(
                candidate.unitMaterials.map(material => ({
                    productVariantId: variant.id,
                    packagingId: material.packagingId,
                    quantityPerUnit: material.quantityPerUnit,
                })),
                { transaction }
            )

            await ProductVariantPalletMaterial.bulkCreate(
                candidate.palletMaterials.map(material => ({
                    productVariantId: variant.id,
                    packagingId: material.packagingId,
                    quantityValue: material.quantityValue,
                })),
                { transaction }
            )

            createdVariants.push(variant)
        }
        return createdVariants
    })
}

async function buildProductVariantImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("SKUs")
    sheet.columns = [
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.productCodigo.header, key: "productCodigo", width: 18 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.skuCode.header, key: "skuCode", width: 16 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.presentationLabel.header, key: "presentationLabel", width: 26 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.boxesPerPallet.header, key: "boxesPerPallet", width: 16 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.bagsPerBox.header, key: "bagsPerBox", width: 16 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.materialCode.header, key: "materialCode", width: 18 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.quantity.header, key: "quantity", width: 12 },
    ]
    sheet.getRow(1).font = { bold: true }

    // Ejemplo 1 -- SKU real, palletizable, ya con precio completo en los 3 Excel de origen del
    // negocio (PAB1310105, "Better Goods Pineapple Juice 6x12oz", Walmart USA). "JUGO-PINA-WM" es
    // un Código Producto ilustrativo -- ese código lo define el admin al curar los Productos base
    // (paso 3 de la carga), no viene de los Excel de origen. Simplificado a 3 de sus 5 materiales
    // reales (el SKU real también lleva etiqueta y manga impresa) para que la plantilla quepa
    // clara -- agregar tantas filas como materiales tenga cada SKU real.
    sheet.addRow({ productCodigo: "JUGO-PINA-WM", skuCode: "PAB1310105", presentationLabel: "Botella 12 oz (0.75 lb)", boxesPerPallet: 385, bagsPerBox: 6, materialCode: "T-ME-AB010", quantity: 1 })
    sheet.addRow({ productCodigo: "JUGO-PINA-WM", skuCode: "PAB1310105", presentationLabel: "Botella 12 oz (0.75 lb)", boxesPerPallet: 385, bagsPerBox: 6, materialCode: "T-ME-AB020", quantity: 1 })
    sheet.addRow({ productCodigo: "JUGO-PINA-WM", skuCode: "PAB1310105", presentationLabel: "Botella 12 oz (0.75 lb)", boxesPerPallet: 385, bagsPerBox: 6, materialCode: "T-ME-AB158", quantity: 385 })

    // Ejemplo 2 -- SKU de demostración (no es un dato real del negocio) que ilustra el rol
    // "empaque intermedio", usando los mismos códigos de ejemplo de la plantilla de Empaques
    // (BOL-001/BOL-002/CAJ-001, ver buildPackagingImportTemplate) para que ambas plantillas se
    // lean juntas como un solo ejemplo coherente.
    sheet.addRow({ productCodigo: "DEMO-PROD", skuCode: "DEMO-001", presentationLabel: "Demo 2kg", boxesPerPallet: 40, bagsPerBox: 50, materialCode: "BOL-001", quantity: 1 })
    sheet.addRow({ productCodigo: "DEMO-PROD", skuCode: "DEMO-001", presentationLabel: "Demo 2kg", boxesPerPallet: 40, bagsPerBox: 50, materialCode: "BOL-002", quantity: 50 })
    sheet.addRow({ productCodigo: "DEMO-PROD", skuCode: "DEMO-001", presentationLabel: "Demo 2kg", boxesPerPallet: 40, bagsPerBox: 50, materialCode: "CAJ-001", quantity: 40 })

    const helpSheet = workbook.addWorksheet("Instrucciones")
    helpSheet.columns = [{ header: "Instrucciones", key: "help", width: 110 }]
    helpSheet.getRow(1).font = { bold: true }
    const helpLines = [
        "Una fila POR CADA material de la receta de empaque de un SKU -- si un SKU tiene 5 materiales, repite sus 6 primeras columnas en 5 filas seguidas, cambiando solo \"Código Material\" y \"Cantidad\".",
        "\"Código Producto\" debe ser el código EXACTO de un Producto ya creado (ver el módulo de Productos) -- este importador NUNCA crea Productos nuevos.",
        "\"Presentación\" debe ser el nombre EXACTO de una Presentación ya creada (ver el módulo de Presentaciones) -- su peso neto ya quedó definido ahí, no se vuelve a pedir acá.",
        "\"Código Material\" debe ser el código EXACTO de un material ya creado en el catálogo de Empaques -- su ROL (empaque individual/intermedio/paletización) se toma de ahí, no se vuelve a declarar en esta plantilla.",
        "\"Cantidad\" significa algo distinto según el rol del material de esa fila: empaque individual = cuántas unidades de ese material lleva CADA bolsa/unidad de producto (casi siempre 1); empaque intermedio = cuántas unidades pequeñas caben en la bolsa/caja grande; material de paletización = cuántas unidades de ese material lleva CADA palet (para la caja que se apila, normalmente es igual a \"Cajas por palet\").",
        "Cada SKU necesita AL MENOS un material de rol \"empaque individual\" y AL MENOS uno de rol \"material de paletización\". El rol \"empaque intermedio\" es opcional, pero un SKU no puede tener más de una fila de ese rol.",
        "\"Cajas por palet\" y \"Bolsas por caja\" deben repetirse IGUAL en todas las filas del mismo SKU -- si varían entre filas del mismo Código SKU, el archivo entero se rechaza.",
        "No incluyas ningún SKU sin \"Cajas por palet\" (producto no palletizable) -- esta plantilla es solo para SKUs que sí se paletizan.",
        "El archivo se valida COMPLETO antes de importar nada: si una sola fila tiene un error, no se crea ningún SKU -- corrige el archivo y vuelve a subirlo.",
        "Un \"Código SKU\" que ya existe en el catálogo se rechaza -- este importador solo CREA SKUs nuevos, no actualiza los que ya existen (usa el formulario de edición para eso).",
    ]
    helpLines.forEach(help => helpSheet.addRow({ help }))

    return writeWorkbookToBuffer(workbook)
}

export const productVariantImportService = {
    bulkImportProductVariants,
    buildProductVariantImportTemplate,
}
