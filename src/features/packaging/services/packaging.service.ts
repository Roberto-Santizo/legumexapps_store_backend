import type { ParsedWorkbook, ParsedRow, ParsedWorksheet } from "../../../shared/utils/parsedWorkbook"
import { Op, WhereOptions } from "sequelize"
import ExcelJS from "exceljs"
import Packaging from "../models/Packaging.model"
import { AppError, BulkImportError, NotFoundError, RowIssue } from "../../../shared/errors/AppError"
import { CreatePackagingInput, UpdatePackagingInput, createPackagingSchema, packagingDefaultsSchema } from "../schemas/packaging.schema"
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
    const where: WhereOptions = {
        isActive: true,
        ...(search ? {
            [Op.or]: [
                { displayName: { [Op.iLike]: `%${search}%` } },
                { code: { [Op.iLike]: `%${search}%` } },
            ],
        } : {}),
    }
    return paginate(Packaging, { where, order: [["displayName", "DESC"]] }, pagination)
}

async function getPackagingById(id: number): Promise<Packaging> {
    const packaging = await Packaging.findOne({ where: { id, isActive: true } })
    if (!packaging) throw new NotFoundError("Packaging", id)
    return packaging
}

// El código es manual y único: se rechaza con un error de negocio claro ANTES de llegar al unique
// constraint de la columna (que daría el 409 genérico "errors.unique_constraint").
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
    const values = input.packagingRole !== "pallet"
        ? { ...input, defaultQuantityBasis: null, defaultQuantityValue: null }
        : { ...input }
    const effective = packagingDefaultsSchema.safeParse({ defaultQuantityBasis: packaging.defaultQuantityBasis, defaultQuantityValue: packaging.defaultQuantityValue == null ? null : Number(packaging.defaultQuantityValue), ...values })
    if (!effective.success) throw new AppError(422, "errors.packaging_consumption_defaults")
    return packaging.update(values)
}

async function deletePackaging(id: number): Promise<void> {
    const packaging = await getPackagingById(id)
    await packaging.update({ isActive: false })
}

// Defensa en profundidad: un packagingId de otro rol (ej. un material de palet como empaque
// individual) se rechaza aunque venga por fuera de la UI, porque alimenta el cálculo.
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
    rawUnitCost: ImportCellValue
}) {
    return {
        // String(...) siempre: un código entrado sin formato de texto en Excel puede llegar como number.
        code: fields.rawCode === null ? fields.rawCode : String(fields.rawCode).trim(),
        displayName: typeof fields.rawDisplayName === "string" ? fields.rawDisplayName.trim() : fields.rawDisplayName,
        packagingRole: fields.resolvedRole,
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
    // code SÍ es único en la BD (displayName solo se revisa dentro del archivo); se reportan ambos
    // problemas para que el admin vea todos los errores de la fila de una vez.
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
    row: ParsedRow,
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
    const rawUnitCost = readImportCell(row, columnIndexByField.get("unitCost"))

    const ctx: PackagingRowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }

    const resolvedRole = resolvePackagingRoleField(rawRole, ctx)
    const baseCandidate = buildPackagingImportCandidate({ rawCode, rawDisplayName, resolvedRole, rawUnitCost })
    const rawBasis = readImportCell(row, columnIndexByField.get("defaultQuantityBasis"))
    const rawValue = readImportCell(row, columnIndexByField.get("defaultQuantityValue"))
    const hasRule = rawBasis != null && rawBasis !== "" || rawValue != null && rawValue !== ""
    const basisMap: Record<string, string> = { "por caja": "per_box", "por pallet": "per_pallet", per_box: "per_box", per_pallet: "per_pallet" }
    const candidate = { ...baseCandidate, ...(hasRule ? {
        defaultQuantityBasis: rawBasis == null || rawBasis === "" ? null : basisMap[normalizeImportText(rawBasis)] ?? String(rawBasis),
        defaultQuantityValue: rawValue == null || rawValue === "" ? null : Number(rawValue),
    } : {}) }

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

// Precarga de todos los códigos existentes (activos o no) para rechazar duplicados contra la BD con
// un RowIssue claro antes del bulkCreate, en vez de que Postgres rechace el batch completo.
async function loadExistingPackagingCodes(): Promise<Set<string>> {
    const existingPackagings = await Packaging.findAll({ attributes: ["code"] })
    return new Set(existingPackagings.map(packaging => normalizeImportText(packaging.code)))
}

function validatePackagingImportHeaders(sheet: ParsedWorksheet): Map<PackagingImportField, number> {
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
    const workbook: ParsedWorkbook = await loadWorkbookFromBuffer(buffer)
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
        // "Código" va primero en la plantilla; el parser mapea por nombre de encabezado, no por posición.
        { header: PACKAGING_IMPORT_COLUMNS.code.header, key: "code", width: 16 },
        { header: PACKAGING_IMPORT_COLUMNS.displayName.header, key: "displayName", width: 32 },
        { header: PACKAGING_IMPORT_COLUMNS.packagingRole.header, key: "packagingRole", width: 34 },
        { header: PACKAGING_IMPORT_COLUMNS.unitCost.header, key: "unitCost", width: 20 },
        { header: PACKAGING_IMPORT_COLUMNS.defaultQuantityBasis.header, key: "defaultQuantityBasis", width: 26 },
        { header: PACKAGING_IMPORT_COLUMNS.defaultQuantityValue.header, key: "defaultQuantityValue", width: 26 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({
        code: "BOL-001",
        displayName: "Bolsa plástica 2kg",
        packagingRole: PACKAGING_ROLE_LABELS.unit,
        unitCost: 1.25
    })
    sheet.addRow({
        code: "BOL-002",
        displayName: "Bolsa grande 50 unidades",
        packagingRole: PACKAGING_ROLE_LABELS.intermediate,
        unitCost: 3.5
    })
    sheet.addRow({
        code: "CAJ-001",
        displayName: "Caja corrugada master",
        packagingRole: PACKAGING_ROLE_LABELS.pallet,
        unitCost: 2, defaultQuantityBasis: "POR CAJA", defaultQuantityValue: 1
    })

    for (const [code, displayName, quantity] of [["ESQ-001", "Esquinero", 4], ["TAR-001", "Tarima", 1], ["STR-001", "Stretch", 93.3]] as const) {
        sheet.addRow({ code, displayName, packagingRole: PACKAGING_ROLE_LABELS.pallet, unitCost: 0, defaultQuantityBasis: "POR PALLET", defaultQuantityValue: quantity })
    }
    for (let row = 2; row <= MAX_PACKAGING_IMPORT_ROWS + 1; row++) sheet.getCell(row, 5).dataValidation = { type: "list", allowBlank: true, formulae: ['"POR CAJA,POR PALLET"'] }
    const helpSheet = workbook.addWorksheet("Valores permitidos")
    helpSheet.columns = [{ header: `${PACKAGING_IMPORT_COLUMNS.packagingRole.header} (valores permitidos)`, key: "role", width: 42 }]
    helpSheet.getRow(1).font = { bold: true }
    Object.values(PACKAGING_ROLE_LABELS).forEach(label => helpSheet.addRow({ role: label }))
    helpSheet.addRow({})
    helpSheet.addRow({ role: `"${PACKAGING_IMPORT_COLUMNS.code.header}" es un texto libre (letras, números y símbolos) que tú defines -- debe ser único, no puede repetirse entre materiales ni dentro del mismo archivo.` })

    helpSheet.addRow({ role: "Forma de consumo: POR CAJA / POR PALLET. Cantidad positiva, máximo dos decimales. Ambos campos completos o ambos vacíos; solamente para paletización. Configure esta regla antes de asociar un material nuevo. Los ejemplos son configuración explícita, no reglas por nombre." })
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
