import { Op, WhereOptions } from "sequelize"
import ExcelJS from "exceljs"
import Presentation from "../models/Presentation.model"
import Category from "../../category/models/Category.model"
import { AppError, BulkImportError, NotFoundError, RowIssue } from "../../../shared/errors/AppError"
import { CreatePresentationInput, UpdatePresentationInput, createPresentationSchema } from "../schemas/presentation.schema"
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
    MAX_PRESENTATION_IMPORT_ROWS,
    PRESENTATION_IMPORT_COLUMNS,
    PresentationImportField,
    REQUIRED_PRESENTATION_IMPORT_FIELDS,
} from "../constants/presentationImport.constant"

async function listPresentations(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Presentation>> {
    const where: WhereOptions = { isActive: true, ...(search ? { displayLabel: { [Op.iLike]: `%${search}%` } } : {}) }
    return paginate(Presentation, { where, order: [["displayLabel", "DESC"]] }, pagination)
}

async function getPresentationById(id: number): Promise<Presentation> {
    const presentation = await Presentation.findOne({ where: { id, isActive: true } })
    if (!presentation) throw new NotFoundError("Presentation", id)
    return presentation
}

async function createPresentation(input: CreatePresentationInput): Promise<Presentation> {
    return Presentation.create(input)
}

async function updatePresentation(id: number, input: UpdatePresentationInput): Promise<Presentation> {
    const presentation = await getPresentationById(id)
    return presentation.update(input)
}

async function deletePresentation(id: number): Promise<void> {
    const presentation = await getPresentationById(id)
    await presentation.update({ isActive: false })
}


type PresentationRowValidation = {
    rowNumber: number
    rowIssues: RowIssue[]
    manuallyValidatedFields: Set<string>
}

function resolvePresentationCategoryField(
    rawCategory: ImportCellValue,
    categoriesByNormalizedName: Map<string, Category[]>,
    ctx: PresentationRowValidation
): number | undefined {
    if (rawCategory === null || rawCategory === "") return undefined
    ctx.manuallyValidatedFields.add("categoryId")

    const matches = categoriesByNormalizedName.get(normalizeImportText(rawCategory)) ?? []
    if (matches.length === 0) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "categoryId", key: "errors.bulk_import_category_not_found", params: { value: rawCategory } })
        return undefined
    }
    if (matches.length > 1) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "categoryId", key: "errors.bulk_import_category_ambiguous", params: { value: rawCategory } })
        return undefined
    }
    return matches[0].id
}

function buildPresentationImportCandidate(fields: {
    rawDisplayLabel: ImportCellValue
    rawNetWeightGrams: ImportCellValue
    resolvedCategoryId: number | undefined
    hasCategoryCell: boolean
}) {
    return {
        displayLabel: typeof fields.rawDisplayLabel === "string" ? fields.rawDisplayLabel.trim() : fields.rawDisplayLabel,
        netWeightGrams: fields.rawNetWeightGrams === null || fields.rawNetWeightGrams === "" ? undefined : Number(fields.rawNetWeightGrams),
        // Si la celda de categoría vino vacía, el campo se omite del candidate (categoryId sigue
        // siendo opcional) -- si vino con texto pero no se resolvió a ninguna Categoría real, se
        // deja `undefined` a propósito: el issue de resolución ya se reportó en
        // resolvePresentationCategoryField, y como quedó en manuallyValidatedFields, zod no lo
        // vuelve a reportar como "falta la categoría" (que sería engañoso -- el problema real es
        // que el texto no matcheó ninguna Categoría, no que faltara la celda).
        ...(fields.hasCategoryCell ? { categoryId: fields.resolvedCategoryId } : {}),
    }
}

function collectPresentationZodIssues(
    candidate: unknown,
    manuallyValidatedFields: Set<string>,
    rowNumber: number
): { validated?: CreatePresentationInput; issues: RowIssue[] } {
    const result = createPresentationSchema.safeParse(candidate)
    if (result.success) return { validated: result.data, issues: [] }

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push({ row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return { issues }
}

function finalizePresentationImportCandidate(
    validated: CreatePresentationInput,
    rowNumber: number,
    firstRowByNormalizedLabel: Map<string, number>,
    rowIssues: RowIssue[]
): CreatePresentationInput | null {
    // A diferencia de Packaging.code/Ingredient.code, Presentation.displayLabel no es único a
    // nivel de columna (varios SKUs comparten el mismo tamaño físico) -- solo se revisa dentro del
    // MISMO archivo, como aviso de posible fila repetida por error, no como bloqueo de negocio.
    const normalizedLabel = normalizeImportText(validated.displayLabel)
    const firstLabelRow = firstRowByNormalizedLabel.get(normalizedLabel)
    if (firstLabelRow) {
        rowIssues.push({
            row: rowNumber,
            field: "displayLabel",
            key: "errors.bulk_import_duplicate_name_in_file",
            params: { displayName: validated.displayLabel, firstRow: firstLabelRow }
        })
        return null
    }

    firstRowByNormalizedLabel.set(normalizedLabel, rowNumber)
    return validated
}

function processPresentationImportRow(
    row: ExcelJS.Row,
    rowNumber: number,
    columnIndexByField: Map<PresentationImportField, number>,
    categoriesByNormalizedName: Map<string, Category[]>,
    firstRowByNormalizedLabel: Map<string, number>,
    rowIssues: RowIssue[]
): CreatePresentationInput | null {
    const rawDisplayLabel = readImportCell(row, columnIndexByField.get("displayLabel"))
    const rawNetWeightGrams = readImportCell(row, columnIndexByField.get("netWeightGrams"))
    const categoryColumnIndex = columnIndexByField.get("categoryId")
    const rawCategory = readImportCell(row, categoryColumnIndex)

    const ctx: PresentationRowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }

    const resolvedCategoryId = resolvePresentationCategoryField(rawCategory, categoriesByNormalizedName, ctx)
    const candidate = buildPresentationImportCandidate({
        rawDisplayLabel, rawNetWeightGrams, resolvedCategoryId, hasCategoryCell: categoryColumnIndex !== undefined
    })

    const { validated, issues: zodIssues } = collectPresentationZodIssues(candidate, ctx.manuallyValidatedFields, rowNumber)
    ctx.rowIssues.push(...zodIssues)

    if (ctx.rowIssues.length > 0) {
        rowIssues.push(...ctx.rowIssues)
        return null
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- rowIssues vacío arriba garantiza que zod sí validó
    return finalizePresentationImportCandidate(validated!, rowNumber, firstRowByNormalizedLabel, rowIssues)
}

async function loadActiveCategoriesByNormalizedName(): Promise<Map<string, Category[]>> {
    const activeCategories = await Category.findAll({ where: { isActive: true } })
    const categoriesByNormalizedName = new Map<string, Category[]>()
    for (const category of activeCategories) {
        const key = normalizeImportText(category.displayName)
        const bucket = categoriesByNormalizedName.get(key) ?? []
        bucket.push(category)
        categoriesByNormalizedName.set(key, bucket)
    }
    return categoriesByNormalizedName
}

function validatePresentationImportHeaders(sheet: ExcelJS.Worksheet): Map<PresentationImportField, number> {
    const columnIndexByField = mapImportHeaders(sheet.getRow(1), PRESENTATION_IMPORT_COLUMNS)
    const missingFields = REQUIRED_PRESENTATION_IMPORT_FIELDS.filter(field => !columnIndexByField.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => PRESENTATION_IMPORT_COLUMNS[field].header).join(", ")
        })
    }
    return columnIndexByField
}

async function bulkImportPresentations(buffer: Buffer): Promise<Presentation[]> {
    const workbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    const columnIndexByField = validatePresentationImportHeaders(sheet)

    if (sheet.rowCount - 1 > MAX_PRESENTATION_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PRESENTATION_IMPORT_ROWS })
    }

    const categoriesByNormalizedName = await loadActiveCategoriesByNormalizedName()

    const rowIssues: RowIssue[] = []
    const candidates: CreatePresentationInput[] = []
    const firstRowByNormalizedLabel = new Map<string, number>()

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const candidate = processPresentationImportRow(row, rowNumber, columnIndexByField, categoriesByNormalizedName, firstRowByNormalizedLabel, rowIssues)
        if (candidate) candidates.push(candidate)
    }

    if (rowIssues.length > 0) {
        throw new BulkImportError(rowIssues)
    }
    if (candidates.length === 0) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    return Presentation.bulkCreate(candidates)
}

async function buildPresentationImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("Presentaciones")
    sheet.columns = [
        { header: PRESENTATION_IMPORT_COLUMNS.displayLabel.header, key: "displayLabel", width: 30 },
        { header: PRESENTATION_IMPORT_COLUMNS.netWeightGrams.header, key: "netWeightGrams", width: 24 },
        { header: PRESENTATION_IMPORT_COLUMNS.categoryId.header, key: "categoryId", width: 20 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({ displayLabel: "Botella 12 oz (0.75 lb)", netWeightGrams: 340.19, categoryId: "Jugos" })
    sheet.addRow({ displayLabel: "Botella 976 ml", netWeightGrams: 976, categoryId: "Jugos" })
    sheet.addRow({ displayLabel: "Bolsa 2 lb", netWeightGrams: 907.18, categoryId: "" })

    const helpSheet = workbook.addWorksheet("Instrucciones")
    helpSheet.columns = [{ header: "Instrucciones", key: "help", width: 100 }]
    helpSheet.getRow(1).font = { bold: true }
    helpSheet.addRow({ help: `"${PRESENTATION_IMPORT_COLUMNS.netWeightGrams.header}" es el peso de UNA sola unidad/bolsa/botella, en gramos -- NUNCA el peso del caso o caja completa. Si solo tienes el peso del caso y cuántas unidades trae, divide primero (peso del caso ÷ unidades por caja) antes de convertir a gramos.` })
    helpSheet.addRow({ help: `"${PRESENTATION_IMPORT_COLUMNS.displayLabel.header}" no necesita ser único -- crea una fila por cada tamaño físico distinto que uses, sin repetir el mismo tamaño más de una vez en este archivo (si se repite, el archivo se rechaza para que revises si fue un error de tipeo).` })
    helpSheet.addRow({ help: `"${PRESENTATION_IMPORT_COLUMNS.categoryId.header}" es opcional -- si la usas, debe ser el nombre EXACTO de una Categoría ya creada.` })

    return writeWorkbookToBuffer(workbook)
}

export const presentationService = {
    listPresentations,
    getPresentationById,
    createPresentation,
    updatePresentation,
    deletePresentation,
    bulkImportPresentations,
    buildPresentationImportTemplate,
}
