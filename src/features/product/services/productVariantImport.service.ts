import ExcelJS from "exceljs"
import { z } from "zod"
import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
import Presentation from "../../presentation/models/Presentation.model"
import Packaging from "../../packaging/models/Packaging.model"
import ProductVariant from "../models/ProductVariant.model"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import ProductVariantIntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import ProductRawMaterial from "../models/ProductRawMaterial.model"
import { AppError, BulkImportError, RowIssue } from "../../../shared/errors/AppError"
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
import { normalizeOptionGroup, optionGroupKey } from "../../../shared/utils/optionGroup.util"
import {
    MAX_PRODUCT_VARIANT_IMPORT_OPTION_GROUP_LENGTH,
    MAX_PRODUCT_VARIANT_IMPORT_ROWS,
    PRODUCT_VARIANT_IMPORT_COLUMNS,
    RECIPE_COMPLETENESS_TOLERANCE,
    ProductVariantImportField,
    REQUIRED_PRODUCT_VARIANT_IMPORT_FIELDS,
} from "../constants/productVariantImport.constant"

const productVariantImportRowSchema = z.object({
    productId: z.number().int().positive(),
    presentationId: z.number().int().positive(),
    boxesPerPallet: z.number().int().positive(),
    bagsPerBox: z.number().int().positive(),
    packagingId: z.number().int().positive(),
    quantity: z.number().positive(),
})
type ProductVariantImportRowInput = z.infer<typeof productVariantImportRowSchema>

interface ResolvedRow extends ProductVariantImportRowInput {
    rowNumber: number
    productCodigo: string
    presentationLabel: string
    packagingRole: string
    packagingDisplayName: string
    // Grupos de opciones: ya normalizado (normalizeOptionGroup), null = fila fija.
    // isDefault es lo que marcó la celda "Predeterminado"; la resolución final (un default por
    // grupo, el primero si no se marcó ninguno) vive en assignOptionGroupDefaults.
    optionGroup: string | null
    isDefault: boolean
}

interface ImportedMaterial {
    packagingId: number
    quantity: number
    optionGroup: string | null
    isDefault: boolean
}

interface SkuImportCandidate {
    productId: number
    presentationId: number
    boxesPerPallet: number
    bagsPerBox: number
    unitsPerIntermediatePackage: number | null
    // Lista (no un único intermediatePackagingId) -- el nivel intermedio es multi-fila (N fijas +
    // N grupos), igual que unit/pallet.
    intermediateMaterials: ImportedMaterial[]
    unitMaterials: ImportedMaterial[]
    palletMaterials: ImportedMaterial[]
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

// "Grupo" (opcional): vacío = fila fija. Mismas reglas de normalización que el admin
// (shared/utils/optionGroup.util.ts); el tope de largo se valida acá para dar un error de fila
// claro en vez de un fallo genérico de la columna STRING(60) al escribir.
function resolveOptionGroupField(rawOptionGroup: ImportCellValue, ctx: RowValidation): string | null {
    const optionGroup = normalizeOptionGroup(rawOptionGroup === null ? null : String(rawOptionGroup))
    if (optionGroup !== null && optionGroup.length > MAX_PRODUCT_VARIANT_IMPORT_OPTION_GROUP_LENGTH) {
        ctx.rowIssues.push({
            row: ctx.rowNumber,
            field: "optionGroup",
            key: "errors.bulk_import_option_group_too_long",
            params: { value: optionGroup, max: MAX_PRODUCT_VARIANT_IMPORT_OPTION_GROUP_LENGTH }
        })
    }
    return optionGroup
}

// "Predeterminado" (opcional): Sí/No con parseImportBoolean, vacío = no marcado. Marcarlo en una
// fila fija (sin Grupo) es un error -- una fila fija siempre se costea, no tiene "default" que
// elegir (decisión: rechazar en vez de ignorar en silencio).
function resolveIsDefaultField(rawIsDefault: ImportCellValue, optionGroup: string | null, ctx: RowValidation): boolean {
    const isDefault = parseImportBoolean(rawIsDefault, false)
    if (isDefault === undefined) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "isDefault", key: "errors.bulk_import_invalid_boolean", params: { value: rawIsDefault } })
        return false
    }
    if (isDefault && optionGroup === null) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "isDefault", key: "errors.bulk_import_default_without_group" })
    }
    return isDefault
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
    const rawPresentationLabel = readImportCell(row, columnIndexByField.get("presentationLabel"))
    const rawBoxesPerPallet = readImportCell(row, columnIndexByField.get("boxesPerPallet"))
    const rawBagsPerBox = readImportCell(row, columnIndexByField.get("bagsPerBox"))
    const rawMaterialCode = readImportCell(row, columnIndexByField.get("materialCode"))
    const rawQuantity = readImportCell(row, columnIndexByField.get("quantity"))
    const rawOptionGroup = readImportCell(row, columnIndexByField.get("optionGroup"))
    const rawIsDefault = readImportCell(row, columnIndexByField.get("isDefault"))

    const ctx: RowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }
    const optionGroup = resolveOptionGroupField(rawOptionGroup, ctx)
    const isDefault = resolveIsDefaultField(rawIsDefault, optionGroup, ctx)

    const productId = resolveProductField(rawProductCodigo, productsByNormalizedCodigo, ctx)
    const presentationId = resolvePresentationField(rawPresentationLabel, presentationsByNormalizedLabel, ctx)
    const packaging = resolveMaterialField(rawMaterialCode, packagingsByNormalizedCode, ctx)

    const candidate = {
        productId,
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

    // productCodigo/presentationLabel crudos (no normalizados) para identificar el grupo de filas
    // en los mensajes de error de finalizeVariantGroup -- no hay skuCode para eso.
    // Ambos existen como string en este punto: rowIssues vacío arriba garantiza que
    // resolveProductField/resolvePresentationField sí resolvieron, y ninguno de los dos devuelve
    // undefined sin empujar un issue primero.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- rowIssues vacío arriba garantiza que zod sí validó, y packaging se resolvió (mismo campo que packagingId)
    return {
        ...validated!,
        rowNumber,
        productCodigo: String(rawProductCodigo).trim(),
        presentationLabel: String(rawPresentationLabel).trim(),
        packagingRole: packaging!.packagingRole,
        packagingDisplayName: packaging!.displayName,
        optionGroup,
        isDefault
    }
}


// Grupos de opciones de UN nivel de UN SKU: filas con el mismo
// grupo (clave insensible a mayúsculas/espacios, optionGroupKey) son alternativas. El nivel sale
// del packagingRole del material, así que el mismo nombre en unit y en pallet son DOS grupos (el
// caller llama a esta función una vez por nivel). Dentro de cada grupo: se conserva la grafía de su
// primera fila; exactamente un default -- el marcado, o si no se marcó ninguno, la PRIMERA fila del
// grupo en el archivo (misma idea que el auto-default de la primera fila en el admin); dos o más
// marcados es un error de fila que nombra el grupo. Deja el mismo estado final que garantizan los
// servicios del admin (un default por grupo), sin pasar por ellos fila por fila.
function assignOptionGroupDefaults(
    rows: ResolvedRow[],
    groupParams: { productCodigo: string; presentationLabel: string },
    rowIssues: RowIssue[]
): { materials: ImportedMaterial[]; hasIssue: boolean } {
    const groups = new Map<string, { label: string; rows: ResolvedRow[] }>()
    for (const row of rows) {
        const key = optionGroupKey(row.optionGroup)
        if (key === null) continue
        const bucket = groups.get(key) ?? { label: row.optionGroup as string, rows: [] }
        bucket.rows.push(row)
        groups.set(key, bucket)
    }

    let hasIssue = false
    const defaultRows = new Set<ResolvedRow>()
    for (const bucket of groups.values()) {
        const markedRows = bucket.rows.filter(row => row.isDefault)
        for (const extraRow of markedRows.slice(1)) {
            rowIssues.push({
                row: extraRow.rowNumber,
                field: "isDefault",
                key: "errors.bulk_import_multiple_defaults_in_group",
                params: { ...groupParams, group: bucket.label }
            })
            hasIssue = true
        }
        defaultRows.add(markedRows[0] ?? bucket.rows[0])
    }

    const materials = rows.map(row => {
        const key = optionGroupKey(row.optionGroup)
        return {
            packagingId: row.packagingId,
            quantity: row.quantity,
            optionGroup: key === null ? null : (groups.get(key)?.label ?? row.optionGroup),
            isDefault: defaultRows.has(row),
        }
    })
    return { materials, hasIssue }
}

// Sin skuCode, el grupo de filas de un mismo SKU se
// identifica por (Producto, Presentación) desde el arranque (ver bulkImportProductVariants, que
// ahora agrupa por esa clave en vez de por skuCode). Por construcción todas las filas de un mismo
// grupo ya comparten productId/presentationId -- ya no hace falta validar eso como "inconsistencia"
// (a diferencia de boxesPerPallet/bagsPerBox, que sí pueden variar por error entre filas repetidas).
function finalizeVariantGroup(
    rows: ResolvedRow[],
    existingProductPresentationPairs: Set<string>,
    claimedProductPresentationPairsInFile: Set<string>,
    productIdsWithCompleteRecipe: Set<number>,
    rowIssues: RowIssue[]
): SkuImportCandidate | null {
    const firstRow = rows[0]
    const groupParams = { productCodigo: firstRow.productCodigo, presentationLabel: firstRow.presentationLabel }
    let hasIssue = false

    // Receta completa antes de crear el SKU (paso 4 de Productos → Recetas → Ingredientes → SKUs): un
    // SKU es lo que hace cotizable a un producto, así que sin receta completa quedaría cotizando $0
    // de materia prima (calculateQuote lo permite a propósito). Ver loadProductIdsWithCompleteRecipe.
    if (!productIdsWithCompleteRecipe.has(firstRow.productId)) {
        rowIssues.push({ row: firstRow.rowNumber, field: "productId", key: "errors.bulk_import_sku_recipe_incomplete", params: groupParams })
        hasIssue = true
    }

    // Un SKU por (Producto, Presentación) -- mismo criterio que
    // productVariant.service.ts::assertPresentationNotAlreadyUsed, acá aplicado en dos frentes:
    // contra la BD (existingProductPresentationPairs) y entre filas del MISMO archivo
    // (claimedProductPresentationPairsInFile, se va llenando a medida que se procesa cada grupo).
    const productPresentationKey = `${firstRow.productId}:${firstRow.presentationId}`
    if (existingProductPresentationPairs.has(productPresentationKey)) {
        rowIssues.push({ row: firstRow.rowNumber, field: "presentationId", key: "errors.bulk_import_sku_presentation_already_used", params: groupParams })
        hasIssue = true
    } else if (claimedProductPresentationPairsInFile.has(productPresentationKey)) {
        rowIssues.push({ row: firstRow.rowNumber, field: "presentationId", key: "errors.bulk_import_sku_presentation_already_used", params: groupParams })
        hasIssue = true
    } else {
        claimedProductPresentationPairsInFile.add(productPresentationKey)
    }

    const isInconsistent = rows.some(row =>
        row.boxesPerPallet !== firstRow.boxesPerPallet ||
        row.bagsPerBox !== firstRow.bagsPerBox
    )
    if (isInconsistent) {
        rowIssues.push({ row: firstRow.rowNumber, field: "presentationId", key: "errors.bulk_import_sku_inconsistent_fields", params: groupParams })
        hasIssue = true
    }

    // Cubre los tres niveles: si saltara las filas intermedias, un material
    // intermedio repetido solo fallaría contra el índice único (productVariantId, packagingId) de la
    // BD con un rollback genérico -- así es un error de fila claro, igual que unit/pallet.
    const seenPackagingIds = new Set<number>()
    for (const row of rows) {
        if (seenPackagingIds.has(row.packagingId)) {
            rowIssues.push({
                row: row.rowNumber,
                field: "materialCode",
                key: "errors.bulk_import_duplicate_material_in_sku",
                params: { ...groupParams, code: row.packagingDisplayName }
            })
            hasIssue = true
        }
        seenPackagingIds.add(row.packagingId)
    }

    // Nivel intermedio multi-fila: se permiten varias filas, pero su "Cantidad" es
    // el unitsPerIntermediatePackage del SKU -- UN solo valor compartido por todos los materiales
    // intermedios --, así que todas deben coincidir (decisión: rechazar, no tomar la primera).
    const intermediateRows = rows.filter(row => row.packagingRole === "intermediate")
    for (const row of intermediateRows.slice(1)) {
        if (row.quantity !== intermediateRows[0].quantity) {
            rowIssues.push({ row: row.rowNumber, field: "quantity", key: "errors.bulk_import_intermediate_quantity_mismatch", params: groupParams })
            hasIssue = true
        }
    }

    const unitRows = rows.filter(row => row.packagingRole === "unit")
    const palletRows = rows.filter(row => row.packagingRole === "pallet")
    if (unitRows.length === 0) {
        rowIssues.push({ row: firstRow.rowNumber, field: "materialCode", key: "errors.bulk_import_sku_missing_unit_materials", params: groupParams })
        hasIssue = true
    }
    if (palletRows.length === 0) {
        rowIssues.push({ row: firstRow.rowNumber, field: "materialCode", key: "errors.bulk_import_sku_missing_pallet_materials", params: groupParams })
        hasIssue = true
    }

    const unitGroups = assignOptionGroupDefaults(unitRows, groupParams, rowIssues)
    const intermediateGroups = assignOptionGroupDefaults(intermediateRows, groupParams, rowIssues)
    const palletGroups = assignOptionGroupDefaults(palletRows, groupParams, rowIssues)
    if (unitGroups.hasIssue || intermediateGroups.hasIssue || palletGroups.hasIssue) hasIssue = true

    if (hasIssue) return null

    return {
        productId: firstRow.productId,
        presentationId: firstRow.presentationId,
        boxesPerPallet: firstRow.boxesPerPallet,
        bagsPerBox: firstRow.bagsPerBox,
        unitsPerIntermediatePackage: intermediateRows[0]?.quantity ?? null,
        intermediateMaterials: intermediateGroups.materials,
        unitMaterials: unitGroups.materials,
        palletMaterials: palletGroups.materials,
    }
}

async function loadProductsByNormalizedCodigo(): Promise<Map<string, Product>> {
    const products = await Product.findAll({ where: { isActive: true } })
    return new Map(products.map(product => [normalizeImportText(product.codigo), product]))
}

// Receta completa = receta fija con filas activas que suman 100 (±0.5, misma tolerancia que el
// motor), o receta personalizable con al menos una materia prima en su pool. Un producto fijo sin
// ninguna fila suma 0, así que también queda incompleto.
async function loadProductIdsWithCompleteRecipe(products: Iterable<Product>): Promise<Set<number>> {
    const recipeRows = await ProductRawMaterial.findAll({ where: { isActive: true }, attributes: ["productId", "percentage"] })
    const statsByProductId = new Map<number, { count: number; total: number }>()
    for (const recipeRow of recipeRows) {
        const stats = statsByProductId.get(recipeRow.productId) ?? { count: 0, total: 0 }
        stats.count += 1
        stats.total += Number(recipeRow.percentage ?? 0)
        statsByProductId.set(recipeRow.productId, stats)
    }

    const complete = new Set<number>()
    for (const product of products) {
        const stats = statsByProductId.get(product.id) ?? { count: 0, total: 0 }
        const isComplete = product.isCustomizable
            ? stats.count > 0
            : Math.abs(stats.total - 100) <= RECIPE_COMPLETENESS_TOLERANCE
        if (isComplete) complete.add(product.id)
    }
    return complete
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


// Un SKU por (Producto, Presentación) -- ver el comentario en finalizeVariantGroup. Clave
// "productId:presentationId" -> ya existe una variante para ese par (sin skuCode no hay un
// código concreto que reportar, solo la existencia del par).
async function loadExistingProductPresentationPairs(): Promise<Set<string>> {
    const existingVariants = await ProductVariant.findAll({ attributes: ["productId", "presentationId"] })
    return new Set(existingVariants.map(variant => `${variant.productId}:${variant.presentationId}`))
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

    const [
        productsByNormalizedCodigo,
        presentationsByNormalizedLabel,
        packagingsByNormalizedCode,
        existingProductPresentationPairs,
    ] = await Promise.all([
        loadProductsByNormalizedCodigo(),
        loadPresentationsByNormalizedLabel(),
        loadPackagingsByNormalizedCode(),
        loadExistingProductPresentationPairs(),
    ])
    const productIdsWithCompleteRecipe = await loadProductIdsWithCompleteRecipe(productsByNormalizedCodigo.values())

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

    // Agrupa filas por (Producto, Presentación): esta clave es la identidad real de un SKU (ver
    // finalizeVariantGroup).
    const rowsByProductPresentation = new Map<string, ResolvedRow[]>()
    for (const row of resolvedRows) {
        const key = `${row.productId}:${row.presentationId}`
        const bucket = rowsByProductPresentation.get(key) ?? []
        bucket.push(row)
        rowsByProductPresentation.set(key, bucket)
    }

    const claimedProductPresentationPairsInFile = new Set<string>()
    const candidates: SkuImportCandidate[] = []
    for (const rows of rowsByProductPresentation.values()) {
        const candidate = finalizeVariantGroup(
            rows,
            existingProductPresentationPairs,
            claimedProductPresentationPairsInFile,
            productIdsWithCompleteRecipe,
            rowIssues
        )
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
                    boxesPerPallet: candidate.boxesPerPallet,
                    bagsPerBox: candidate.bagsPerBox,
                    unitsPerIntermediatePackage: candidate.unitsPerIntermediatePackage,
                },
                { transaction }
            )

            // Grupos de opciones: optionGroup/isDefault ya vienen resueltos por
            // assignOptionGroupDefaults (un default por grupo, null/false en las filas fijas) y se
            // escriben tal cual -- NO se pasa por los servicios del admin, cuyo manejo de defaults
            // asume filas que llegan de a una; el estado final es el mismo que ellos garantizan.
            // Sin columnas Grupo/Predeterminado en el archivo, todo llega como fila fija, igual que antes.
            if (candidate.intermediateMaterials.length > 0) {
                await ProductVariantIntermediateMaterial.bulkCreate(
                    candidate.intermediateMaterials.map(material => ({
                        productVariantId: variant.id,
                        packagingId: material.packagingId,
                        optionGroup: material.optionGroup,
                        isDefault: material.isDefault,
                    })),
                    { transaction }
                )
            }

            await ProductVariantUnitMaterial.bulkCreate(
                candidate.unitMaterials.map(material => ({
                    productVariantId: variant.id,
                    packagingId: material.packagingId,
                    quantityPerUnit: material.quantity,
                    optionGroup: material.optionGroup,
                    isDefault: material.isDefault,
                })),
                { transaction }
            )

            await ProductVariantPalletMaterial.bulkCreate(
                candidate.palletMaterials.map(material => ({
                    productVariantId: variant.id,
                    packagingId: material.packagingId,
                    quantityValue: material.quantity,
                    optionGroup: material.optionGroup,
                    isDefault: material.isDefault,
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
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.presentationLabel.header, key: "presentationLabel", width: 26 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.boxesPerPallet.header, key: "boxesPerPallet", width: 16 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.bagsPerBox.header, key: "bagsPerBox", width: 16 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.materialCode.header, key: "materialCode", width: 18 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.quantity.header, key: "quantity", width: 12 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.optionGroup.header, key: "optionGroup", width: 16 },
        { header: PRODUCT_VARIANT_IMPORT_COLUMNS.isDefault.header, key: "isDefault", width: 16 },
    ]
    sheet.getRow(1).font = { bold: true }


    sheet.addRow({ productCodigo: "JUGO-PINA-WM", presentationLabel: "Botella 12 oz (0.75 lb)", boxesPerPallet: 385, bagsPerBox: 6, materialCode: "T-ME-AB010", quantity: 1 })
    sheet.addRow({ productCodigo: "JUGO-PINA-WM", presentationLabel: "Botella 12 oz (0.75 lb)", boxesPerPallet: 385, bagsPerBox: 6, materialCode: "T-ME-AB020", quantity: 1 })
    sheet.addRow({ productCodigo: "JUGO-PINA-WM", presentationLabel: "Botella 12 oz (0.75 lb)", boxesPerPallet: 385, bagsPerBox: 6, materialCode: "T-ME-AB158", quantity: 385 })


    // Ejemplo con grupos de opciones: un material fijo (FILM-001, sin Grupo), un grupo
    // "Caja" de dos alternativas con una marcada como predeterminada, y un grupo "Esquinero" sin
    // marcar (su primera fila queda como predeterminada).
    const demo = { productCodigo: "DEMO-PROD", presentationLabel: "Demo 2kg", boxesPerPallet: 40, bagsPerBox: 50 }
    sheet.addRow({ ...demo, materialCode: "BOL-001", quantity: 1 })
    sheet.addRow({ ...demo, materialCode: "BOL-002", quantity: 50 })
    sheet.addRow({ ...demo, materialCode: "FILM-001", quantity: 1 })
    sheet.addRow({ ...demo, materialCode: "CAJ-001", quantity: 40, optionGroup: "Caja", isDefault: "Sí" })
    sheet.addRow({ ...demo, materialCode: "CAJ-002", quantity: 40, optionGroup: "Caja" })
    sheet.addRow({ ...demo, materialCode: "ESQ-001", quantity: 4, optionGroup: "Esquinero" })
    sheet.addRow({ ...demo, materialCode: "ESQ-002", quantity: 4, optionGroup: "Esquinero" })

    const helpSheet = workbook.addWorksheet("Instrucciones")
    helpSheet.columns = [{ header: "Instrucciones", key: "help", width: 110 }]
    helpSheet.getRow(1).font = { bold: true }
    const helpLines = [
        "Una fila POR CADA material de la receta de empaque de un SKU -- si un SKU tiene 5 materiales, repite sus 5 primeras columnas en 5 filas seguidas, cambiando solo \"Código Material\" y \"Cantidad\".",
        "Un SKU es, por definición, un Producto en UNA Presentación -- \"Código Producto\" + \"Presentación\" juntos identifican el SKU, ya no hay una columna de código de SKU separada.",
        "PASO 4 de 4: Productos → Recetas → Ingredientes (opcional) → SKUs. \"Código Producto\" debe ser el código EXACTO de un Producto ya creado (paso 1) -- este importador NUNCA crea Productos nuevos. Su receta ya debe estar completa (paso 2): una receta fija que sume 100%, o una personalizable con al menos una materia prima; si no, sus SKUs se rechazan. Los ingredientes agregados (paso 3) son opcionales y no bloquean los SKUs.",
        "\"Presentación\" debe ser el nombre EXACTO de una Presentación ya creada (ver el módulo de Presentaciones) -- su peso neto ya quedó definido ahí, no se vuelve a pedir acá.",
        "\"Código Material\" debe ser el código EXACTO de un material ya creado en el catálogo de Empaques -- su ROL (empaque individual/intermedio/paletización) se toma de ahí, no se vuelve a declarar en esta plantilla.",
        "\"Cantidad\" significa algo distinto según el rol del material de esa fila: empaque individual = cuántas unidades de ese material lleva CADA bolsa/unidad de producto (casi siempre 1); empaque intermedio = cuántas unidades pequeñas caben en la bolsa/caja grande; material de paletización = cuántas unidades de ese material lleva CADA palet (para la caja que se apila, normalmente es igual a \"Cajas por palet\").",
        "Cada SKU necesita AL MENOS un material de rol \"empaque individual\" y AL MENOS uno de rol \"material de paletización\". El rol \"empaque intermedio\" es opcional y admite varias filas, pero todas deben traer la MISMA \"Cantidad\" (es un solo valor por SKU: cuántas unidades van en cada empaque intermedio).",
        "\"Grupo\" (opcional): déjalo vacío para un material FIJO, que siempre se cotiza. Si escribes un nombre (ej. Caja, Esquinero, Bolsa), las filas del mismo SKU con el mismo Grupo y del mismo nivel (individual, intermedio o paletización) son ALTERNATIVAS: el cliente elige una por grupo al cotizar. Grupos distintos se suman (ej. una caja Y un esquinero). Mayúsculas y espacios no importan (\"caja\" y \"CAJA\" son el mismo grupo); el mismo nombre en dos niveles distintos son dos grupos distintos. Máximo 60 caracteres.",
        "\"Predeterminado\" (opcional): escribe Sí en la opción que se usa cuando el cliente no elige otra. Solo UNA por grupo; si no marcas ninguna, la primera fila del grupo en el archivo queda como predeterminada. No se puede marcar en un material fijo (sin Grupo).",
        "Las columnas \"Grupo\" y \"Predeterminado\" se pueden omitir del archivo: sin ellas, todos los materiales se importan como fijos.",
        "\"Cajas por palet\" y \"Bolsas por caja\" deben repetirse IGUAL en todas las filas del mismo SKU -- si varían entre filas del mismo Producto+Presentación, el archivo entero se rechaza.",
        "No incluyas ningún SKU sin \"Cajas por palet\" (producto no palletizable) -- esta plantilla es solo para SKUs que sí se paletizan.",
        "El archivo se valida COMPLETO antes de importar nada: si una sola fila tiene un error, no se crea ningún SKU -- corrige el archivo y vuelve a subirlo.",
        "Un SKU (Producto + Presentación) que ya existe en el catálogo se rechaza -- este importador solo CREA SKUs nuevos, no actualiza los que ya existen (usa el formulario de edición para eso).",
    ]
    helpLines.forEach(help => helpSheet.addRow({ help }))

    return writeWorkbookToBuffer(workbook)
}

export const productVariantImportService = {
    bulkImportProductVariants,
    buildProductVariantImportTemplate,
}
