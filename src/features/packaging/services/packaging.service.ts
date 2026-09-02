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

async function createPackaging(input: CreatePackagingInput): Promise<Packaging> {
    return Packaging.create(input)
}

async function updatePackaging(id: number, input: UpdatePackagingInput): Promise<Packaging> {
    const packaging = await getPackagingById(id)
    return packaging.update(input)
}

async function deletePackaging(id: number): Promise<void> {
    const packaging = await getPackagingById(id)
    await packaging.update({ isActive: false })
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
    rawDisplayName: ImportCellValue
    resolvedRole: string | undefined
    rawMaterial: ImportCellValue
    rawUnitCost: ImportCellValue
}) {
    return {
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
    rowIssues: RowIssue[]
): CreatePackagingInput | null {
    const normalizedName = normalizeImportText(validated.displayName)
    const firstRow = firstRowByNormalizedName.get(normalizedName)
    if (firstRow) {
        rowIssues.push({
            row: rowNumber,
            field: "displayName",
            key: "errors.bulk_import_duplicate_name_in_file",
            params: { displayName: validated.displayName, firstRow }
        })
        return null
    }
    firstRowByNormalizedName.set(normalizedName, rowNumber)
    return validated
}

function processPackagingImportRow(
    row: ExcelJS.Row,
    rowNumber: number,
    columnIndexByField: Map<PackagingImportField, number>,
    firstRowByNormalizedName: Map<string, number>,
    rowIssues: RowIssue[]
): CreatePackagingInput | null {
    const rawDisplayName = readImportCell(row, columnIndexByField.get("displayName"))
    const rawRole = readImportCell(row, columnIndexByField.get("packagingRole"))
    const rawMaterial = readImportCell(row, columnIndexByField.get("packagingMaterial"))
    const rawUnitCost = readImportCell(row, columnIndexByField.get("unitCost"))

    const ctx: PackagingRowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }

    const resolvedRole = resolvePackagingRoleField(rawRole, ctx)
    const candidate = buildPackagingImportCandidate({ rawDisplayName, resolvedRole, rawMaterial, rawUnitCost })

    const { validated, issues: zodIssues } = collectPackagingZodIssues(candidate, ctx.manuallyValidatedFields, rowNumber)
    ctx.rowIssues.push(...zodIssues)

    if (ctx.rowIssues.length > 0) {
        rowIssues.push(...ctx.rowIssues)
        return null
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- rowIssues vacío arriba garantiza que zod sí validó
    return finalizePackagingImportCandidate(validated!, rowNumber, firstRowByNormalizedName, rowIssues)
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

    const rowIssues: RowIssue[] = []
    const candidates: CreatePackagingInput[] = []
    const firstRowByNormalizedName = new Map<string, number>()

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const candidate = processPackagingImportRow(row, rowNumber, columnIndexByField, firstRowByNormalizedName, rowIssues)
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
        { header: PACKAGING_IMPORT_COLUMNS.displayName.header, key: "displayName", width: 32 },
        { header: PACKAGING_IMPORT_COLUMNS.packagingRole.header, key: "packagingRole", width: 34 },
        { header: PACKAGING_IMPORT_COLUMNS.packagingMaterial.header, key: "packagingMaterial", width: 24 },
        { header: PACKAGING_IMPORT_COLUMNS.unitCost.header, key: "unitCost", width: 20 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({
        displayName: "Bolsa plástica 2kg",
        packagingRole: PACKAGING_ROLE_LABELS.unit,
        packagingMaterial: "Polietileno",
        unitCost: 1.25
    })
    sheet.addRow({
        displayName: "Bolsa grande 50 unidades",
        packagingRole: PACKAGING_ROLE_LABELS.intermediate,
        packagingMaterial: "Polipropileno",
        unitCost: 3.5
    })
    sheet.addRow({
        displayName: "Caja corrugada master",
        packagingRole: PACKAGING_ROLE_LABELS.pallet,
        packagingMaterial: "Cartón corrugado",
        unitCost: 2
    })

    const helpSheet = workbook.addWorksheet("Valores permitidos")
    helpSheet.columns = [{ header: `${PACKAGING_IMPORT_COLUMNS.packagingRole.header} (valores permitidos)`, key: "role", width: 42 }]
    helpSheet.getRow(1).font = { bold: true }
    Object.values(PACKAGING_ROLE_LABELS).forEach(label => helpSheet.addRow({ role: label }))

    return writeWorkbookToBuffer(workbook)
}

export const packagingService = {
    listPackagings,
    getPackagingById,
    createPackaging,
    updatePackaging,
    deletePackaging,
    bulkImportPackagings,
    buildPackagingImportTemplate,
}
