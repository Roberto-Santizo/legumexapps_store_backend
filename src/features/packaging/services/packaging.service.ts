import { Op, WhereOptions } from "sequelize"
import ExcelJS from "exceljs"
import Packaging from "../models/Packaging.model"
import { AppError, BulkImportError, NotFoundError, RowIssue } from "../../../shared/errors/AppError"
import { CreatePackagingInput, UpdatePackagingInput, createPackagingSchema } from "../schemas/packaging.schema"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"
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
    MAX_PACKAGING_IMPORT_ROWS,
    PACKAGING_IMPORT_COLUMNS,
    PACKAGING_ROLE_LABELS,
    PACKAGING_ROLE_LABEL_TO_KEY,
    PackagingImportField,
    REQUIRED_PACKAGING_IMPORT_FIELDS,
} from "../constants/packagingImport.constant"

async function listPackagings(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Packaging>> {
    const where: WhereOptions = { isActive: true, ...(search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}) }
    return paginate(Packaging, { where, order: [["displayName", "DESC"]] }, pagination)
}

async function getPackagingById(id: number): Promise<Packaging> {
    const packaging = await Packaging.findOne({ where: { id, isActive: true } })
    if (!packaging) throw new NotFoundError("Packaging", id)
    return packaging
}

// El código es manual (nunca se autogenera) y único -- se rechaza con un error de negocio claro
// ANTES de llegar al unique constraint de la columna (que daría el 409 genérico
// "errors.unique_constraint" vía errorHandler, menos útil para el admin). Mismo patrón que
// ingredient.service.ts::assertCodeIsUnique.
async function assertCodeIsUnique(code: string, excludeId?: number): Promise<void> {
    const where: WhereOptions = excludeId ? { code, id: { [Op.ne]: excludeId } } : { code }
    const existing = await Packaging.findOne({ where })
    if (existing) throw new AppError(409, "errors.packaging_code_already_exists", { code })
}

async function createPackaging(input: CreatePackagingInput): Promise<Packaging> {
    await assertCodeIsUnique(input.code)
    return Packaging.create(input)
}

async function updatePackaging(id: number, input: UpdatePackagingInput): Promise<Packaging> {
    const packaging = await getPackagingById(id)
    if (input.code) await assertCodeIsUnique(input.code, id)
    return packaging.update(input)
}

async function deletePackaging(id: number): Promise<void> {
    const packaging = await getPackagingById(id)
    await packaging.update({ isActive: false })
}

// Defensa en profundidad para los joins de materiales de variante (ProductVariantUnitMaterial
// "unit" / ProductVariantPalletMaterial "pallet"): hasta ahora el filtro por rol solo vivía en
// el <select> del frontend (PackagingSelect/PalletMaterialSelect), nunca se revalidaba acá --
// un cliente que mandara un packagingId de otro rol por fuera de la UI (ej. un material de
// palet como si fuera empaque individual) se aceptaba en silencio. Mismo criterio que el resto
// del repo: nunca confiar solo en el filtro de la UI para algo que alimenta el cálculo/catálogo.
async function assertPackagingHasRole(packagingId: number, expectedRole: string): Promise<Packaging> {
    const packaging = await getPackagingById(packagingId)
    if (packaging.packagingRole !== expectedRole) {
        throw new AppError(422, "errors.packaging_role_mismatch", {
            packagingId,
            expectedRole,
            actualRole: packaging.packagingRole
        })
    }
    return packaging
}

type PackagingRowValidation = {
    rowNumber: number
    rowIssues: RowIssue[]
    manuallyValidatedFields: Set<string>
}

function resolvePackagingRoleField(rawRole: ImportCellValue, ctx: PackagingRowValidation): string | undefined {
    if (rawRole === null) return undefined
    const resolvedRole = PACKAGING_ROLE_LABEL_TO_KEY[normalizeImportText(rawRole)]
    if (resolvedRole) return resolvedRole

    ctx.manuallyValidatedFields.add("packagingRole")
    ctx.rowIssues.push({
        row: ctx.rowNumber,
        field: "packagingRole",
        key: "errors.bulk_import_unknown_role",
        params: { value: rawRole, validValues: Object.values(PACKAGING_ROLE_LABELS).join(", ") }
    })
    return undefined
}

function buildPackagingImportCandidate(fields: {
    rawCode: ImportCellValue
    rawDisplayName: ImportCellValue
    resolvedRole: string | undefined
    rawMaterial: ImportCellValue
    rawUnitCost: ImportCellValue
}) {
    return {
        // String(...) y no el mismo trim condicional que displayName: un código entrado sin
        // formato de texto en Excel puede llegar como number -- hay que forzarlo a string siempre
        // para no romper el schema (code es string). Mismo criterio que ingredient.service.ts.
        code: fields.rawCode === null ? fields.rawCode : String(fields.rawCode).trim(),
        displayName: typeof fields.rawDisplayName === "string" ? fields.rawDisplayName.trim() : fields.rawDisplayName,
        packagingRole: fields.resolvedRole,
        packagingMaterial: typeof fields.rawMaterial === "string" ? fields.rawMaterial.trim() || undefined : undefined,
        unitCost: fields.rawUnitCost === null || fields.rawUnitCost === "" ? undefined : Number(fields.rawUnitCost),
    }
}

function collectPackagingZodIssues(
    candidate: unknown,
    manuallyValidatedFields: Set<string>,
    rowNumber: number
): { validated?: CreatePackagingInput; issues: RowIssue[] } {
    const result = createPackagingSchema.safeParse(candidate)
    if (result.success) return { validated: result.data, issues: [] }

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push({ row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return { issues }
}


function finalizePackagingImportCandidate(
    validated: CreatePackagingInput,
    rowNumber: number,
    firstRowByNormalizedName: Map<string, number>,
    firstRowByNormalizedCode: Map<string, number>,
    existingCodesByNormalized: Set<string>,
    rowIssues: RowIssue[]
): CreatePackagingInput | null {
    // A diferencia de displayName (no es único a nivel de columna, solo se revisa dentro del
    // archivo), code SÍ es único en la BD -- se reportan ambos problemas si aplican, en vez de
    // cortar en el primero, para que el admin vea todos los errores de la fila de una vez. Mismo
    // criterio que ingredient.service.ts::finalizeIngredientImportCandidate.
    let hasIssue = false

    const normalizedName = normalizeImportText(validated.displayName)
    const firstNameRow = firstRowByNormalizedName.get(normalizedName)
    if (firstNameRow) {
        rowIssues.push({
            row: rowNumber,
            field: "displayName",
            key: "errors.bulk_import_duplicate_name_in_file",
            params: { displayName: validated.displayName, firstRow: firstNameRow }
        })
        hasIssue = true
    }

    const normalizedCode = normalizeImportText(validated.code)
    const firstCodeRow = firstRowByNormalizedCode.get(normalizedCode)
    if (firstCodeRow) {
        rowIssues.push({
            row: rowNumber,
            field: "code",
            key: "errors.bulk_import_duplicate_code_in_file",
            params: { code: validated.code, firstRow: firstCodeRow }
        })
        hasIssue = true
    } else if (existingCodesByNormalized.has(normalizedCode)) {
        rowIssues.push({
            row: rowNumber,
            field: "code",
            key: "errors.packaging_code_already_exists",
            params: { code: validated.code }
        })
        hasIssue = true
    }

    if (hasIssue) return null

    firstRowByNormalizedName.set(normalizedName, rowNumber)
    firstRowByNormalizedCode.set(normalizedCode, rowNumber)
    return validated
}

function processPackagingImportRow(
    row: ExcelJS.Row,
    rowNumber: number,
    columnIndexByField: Map<PackagingImportField, number>,
    firstRowByNormalizedName: Map<string, number>,
    firstRowByNormalizedCode: Map<string, number>,
    existingCodesByNormalized: Set<string>,
    rowIssues: RowIssue[]
): CreatePackagingInput | null {
    const rawCode = readImportCell(row, columnIndexByField.get("code"))
    const rawDisplayName = readImportCell(row, columnIndexByField.get("displayName"))
    const rawRole = readImportCell(row, columnIndexByField.get("packagingRole"))
    const rawMaterial = readImportCell(row, columnIndexByField.get("packagingMaterial"))
    const rawUnitCost = readImportCell(row, columnIndexByField.get("unitCost"))

    const ctx: PackagingRowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }

    const resolvedRole = resolvePackagingRoleField(rawRole, ctx)
    const candidate = buildPackagingImportCandidate({ rawCode, rawDisplayName, resolvedRole, rawMaterial, rawUnitCost })

    const { validated, issues: zodIssues } = collectPackagingZodIssues(candidate, ctx.manuallyValidatedFields, rowNumber)
    ctx.rowIssues.push(...zodIssues)

    if (ctx.rowIssues.length > 0) {
        rowIssues.push(...ctx.rowIssues)
        return null
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- rowIssues vacío arriba garantiza que zod sí validó
    return finalizePackagingImportCandidate(
        validated!, rowNumber, firstRowByNormalizedName, firstRowByNormalizedCode, existingCodesByNormalized, rowIssues
    )
}

// Preload de todos los códigos de material ya existentes (activos o no) para poder rechazar
// duplicados-contra-la-BD con un RowIssue claro ANTES de intentar el bulkCreate, en vez de dejar
// que Postgres reviente el batch completo con una violación de unique constraint genérica. Mismo
// patrón que ingredient.service.ts::loadExistingIngredientCodes.
async function loadExistingPackagingCodes(): Promise<Set<string>> {
    const existingPackagings = await Packaging.findAll({ attributes: ["code"] })
    return new Set(existingPackagings.map(packaging => normalizeImportText(packaging.code)))
}

function validatePackagingImportHeaders(sheet: ExcelJS.Worksheet): Map<PackagingImportField, number> {
    const columnIndexByField = mapImportHeaders(sheet.getRow(1), PACKAGING_IMPORT_COLUMNS)
    const missingFields = REQUIRED_PACKAGING_IMPORT_FIELDS.filter(field => !columnIndexByField.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => PACKAGING_IMPORT_COLUMNS[field].header).join(", ")
        })
    }
    return columnIndexByField
}

async function bulkImportPackagings(buffer: Buffer): Promise<Packaging[]> {
    const workbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    const columnIndexByField = validatePackagingImportHeaders(sheet)

    if (sheet.rowCount - 1 > MAX_PACKAGING_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PACKAGING_IMPORT_ROWS })
    }

    const existingCodesByNormalized = await loadExistingPackagingCodes()

    const rowIssues: RowIssue[] = []
    const candidates: CreatePackagingInput[] = []
    const firstRowByNormalizedName = new Map<string, number>()
    const firstRowByNormalizedCode = new Map<string, number>()

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const candidate = processPackagingImportRow(
            row, rowNumber, columnIndexByField, firstRowByNormalizedName, firstRowByNormalizedCode, existingCodesByNormalized, rowIssues
        )
        if (candidate) candidates.push(candidate)
    }

    if (rowIssues.length > 0) {
        throw new BulkImportError(rowIssues)
    }
    if (candidates.length === 0) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    return Packaging.bulkCreate(candidates)
}

async function buildPackagingImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("Empaques")
    sheet.columns = [
        // "Código" va PRIMERO a propósito (columna de identificación del material) -- el
        // parser en sí no depende del orden físico de columnas (mapImportHeaders matchea por
        // nombre de encabezado), pero la plantilla descargable sí debe mostrarlo primero.
        { header: PACKAGING_IMPORT_COLUMNS.code.header, key: "code", width: 16 },
        { header: PACKAGING_IMPORT_COLUMNS.displayName.header, key: "displayName", width: 32 },
        { header: PACKAGING_IMPORT_COLUMNS.packagingRole.header, key: "packagingRole", width: 34 },
        { header: PACKAGING_IMPORT_COLUMNS.packagingMaterial.header, key: "packagingMaterial", width: 24 },
        { header: PACKAGING_IMPORT_COLUMNS.unitCost.header, key: "unitCost", width: 20 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({
        code: "BOL-001",
        displayName: "Bolsa plástica 2kg",
        packagingRole: PACKAGING_ROLE_LABELS.unit,
        packagingMaterial: "Polietileno",
        unitCost: 1.25
    })
    sheet.addRow({
        code: "BOL-002",
        displayName: "Bolsa grande 50 unidades",
        packagingRole: PACKAGING_ROLE_LABELS.intermediate,
        packagingMaterial: "Polipropileno",
        unitCost: 3.5
    })
    sheet.addRow({
        code: "CAJ-001",
        displayName: "Caja corrugada master",
        packagingRole: PACKAGING_ROLE_LABELS.pallet,
        packagingMaterial: "Cartón corrugado",
        unitCost: 2
    })

    const helpSheet = workbook.addWorksheet("Valores permitidos")
    helpSheet.columns = [{ header: `${PACKAGING_IMPORT_COLUMNS.packagingRole.header} (valores permitidos)`, key: "role", width: 42 }]
    helpSheet.getRow(1).font = { bold: true }
    Object.values(PACKAGING_ROLE_LABELS).forEach(label => helpSheet.addRow({ role: label }))
    helpSheet.addRow({})
    helpSheet.addRow({ role: `"${PACKAGING_IMPORT_COLUMNS.code.header}" es un texto libre (letras, números y símbolos) que tú defines -- debe ser único, no puede repetirse entre materiales ni dentro del mismo archivo.` })

    return writeWorkbookToBuffer(workbook)
}

export const packagingService = {
    listPackagings,
    getPackagingById,
    createPackaging,
    updatePackaging,
    deletePackaging,
    assertPackagingHasRole,
    bulkImportPackagings,
    buildPackagingImportTemplate,
}
