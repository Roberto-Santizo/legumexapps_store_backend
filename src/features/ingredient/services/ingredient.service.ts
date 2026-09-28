import { Op, WhereOptions } from "sequelize"
import ExcelJS from "exceljs"
import Ingredient from "../models/Ingredient.model"
import IngredientTranslation from "../models/IngredientTranslation.model"
import { unitService } from "../../unit/services/unit.service"
import { AppError, BulkImportError, NotFoundError, RowIssue } from "../../../shared/errors/AppError"
import { CreateIngredientInput, UpdateIngredientInput, IngredientTranslationInput, createIngredientSchema } from "../schemas/ingredient.schema"
import { generateUniqueSlug } from "../../../shared/utils/slug.util"
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
    INGREDIENT_IMPORT_COLUMNS,
    IngredientImportField,
    MAX_INGREDIENT_IMPORT_ROWS,
    REQUIRED_INGREDIENT_IMPORT_FIELDS,
} from "../constants/ingredientImport.constant"

async function listIngredients(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Ingredient>> {
    const where: WhereOptions = { isActive: true, ...(search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}) }
    return paginate(
        Ingredient,
        { where, order: [["displayName", "DESC"]], include: [{ model: IngredientTranslation, as: "translations" }] },
        pagination
    )
}

async function getIngredientById(id: number): Promise<Ingredient> {
    const ingredient = await Ingredient.findOne({
        where: { id, isActive: true },
        include: [{ model: IngredientTranslation, as: "translations" }]
    })
    if (!ingredient) throw new NotFoundError("Ingredient", id)
    return ingredient
}

async function syncEnglishTranslation(ingredientId: number, en: IngredientTranslationInput | undefined): Promise<void> {
    if (!en?.displayName) return
    const [translation] = await IngredientTranslation.findOrCreate({
        where: { ingredientId, language: "en" },
        defaults: { ingredientId, language: "en", displayName: en.displayName }
    })
    await translation.update({ displayName: en.displayName })
}

// Mismo criterio que rawMaterial.service.ts::assertCodeIsUnique -- error de negocio claro antes
// del unique constraint genérico de la columna.
async function assertCodeIsUnique(code: string, excludeId?: number): Promise<void> {
    const where: WhereOptions = excludeId ? { code, id: { [Op.ne]: excludeId } } : { code }
    const existing = await Ingredient.findOne({ where })
    if (existing) throw new AppError(409, "errors.ingredient_code_already_exists", { code })
}

async function createIngredient(input: CreateIngredientInput): Promise<Ingredient> {
    const { translations, ...rest } = input
    await assertCodeIsUnique(rest.code)
    const urlSlug = await generateUniqueSlug(rest.displayName, async (candidate) => {
        const existing = await Ingredient.findOne({ where: { urlSlug: candidate } })
        return !!existing
    })
    const poundUnit = await unitService.findOrCreatePoundUnit()
    const ingredient = await Ingredient.create({ ...rest, urlSlug, costUnitId: poundUnit.id })
    await syncEnglishTranslation(ingredient.id, translations?.en)
    return getIngredientById(ingredient.id)
}

async function updateIngredient(id: number, input: UpdateIngredientInput): Promise<Ingredient> {
    const ingredient = await getIngredientById(id)
    const { translations, ...rest } = input
    if (rest.code) await assertCodeIsUnique(rest.code, id)
    const poundUnit = await unitService.findOrCreatePoundUnit()
    await ingredient.update({ ...rest, costUnitId: poundUnit.id })
    await syncEnglishTranslation(id, translations?.en)
    return getIngredientById(id)
}

async function deleteIngredient(id: number): Promise<void> {
    const ingredient = await getIngredientById(id)
    await ingredient.update({ isActive: false })
}


type ImportedIngredientCandidate = CreateIngredientInput & { urlSlug: string }

type IngredientImportAccumulators = {
    firstRowByNormalizedName: Map<string, number>
    firstRowByNormalizedCode: Map<string, number>
    existingCodesByNormalized: Set<string>
    assignedSlugs: Set<string>
    rowIssues: RowIssue[]
}

function buildIngredientImportCandidate(fields: {
    rawCode: ImportCellValue
    rawDisplayName: ImportCellValue
    rawCostPerUnit: ImportCellValue
    rawDisplayNameEn: ImportCellValue
}) {
    const displayNameEn = typeof fields.rawDisplayNameEn === "string" ? fields.rawDisplayNameEn.trim() : ""
    return {
        // String(...) siempre -- un código numérico entrado sin formato de texto llega como number
        // (mismo motivo que en el importador de materias primas).
        code: fields.rawCode === null ? fields.rawCode : String(fields.rawCode).trim(),
        displayName: typeof fields.rawDisplayName === "string" ? fields.rawDisplayName.trim() : fields.rawDisplayName,
        costPerUnit: fields.rawCostPerUnit === null || fields.rawCostPerUnit === "" ? undefined : Number(fields.rawCostPerUnit),
        translations: displayNameEn ? { en: { displayName: displayNameEn } } : undefined,
    }
}

function collectZodIssues(candidate: unknown, rowNumber: number): { validated?: CreateIngredientInput; issues: RowIssue[] } {
    const result = createIngredientSchema.safeParse(candidate)
    if (result.success) return { validated: result.data, issues: [] }

    const issues: RowIssue[] = result.error.issues.map(issue => ({
        row: rowNumber,
        field: issue.path.join(".") || "row",
        key: `errors.zod.${issue.code}`,
        params: { defaultValue: issue.message }
    }))
    return { issues }
}

async function finalizeIngredientImportCandidate(
    validated: CreateIngredientInput,
    rowNumber: number,
    accumulators: IngredientImportAccumulators
): Promise<ImportedIngredientCandidate | null> {
    const { firstRowByNormalizedName, firstRowByNormalizedCode, existingCodesByNormalized, assignedSlugs, rowIssues } = accumulators
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
            key: "errors.ingredient_code_already_exists",
            params: { code: validated.code }
        })
        hasIssue = true
    }

    if (hasIssue) return null

    firstRowByNormalizedName.set(normalizedName, rowNumber)
    firstRowByNormalizedCode.set(normalizedCode, rowNumber)

    const urlSlug = await generateUniqueSlug(validated.displayName, async (candidateSlug) => {
        if (assignedSlugs.has(candidateSlug)) return true
        const existing = await Ingredient.findOne({ where: { urlSlug: candidateSlug } })
        return !!existing
    })
    assignedSlugs.add(urlSlug)

    return { ...validated, urlSlug }
}

async function processIngredientImportRow(
    row: ExcelJS.Row,
    rowNumber: number,
    columnIndexByField: Map<IngredientImportField, number>,
    accumulators: IngredientImportAccumulators
): Promise<ImportedIngredientCandidate | null> {
    const candidate = buildIngredientImportCandidate({
        rawCode: readImportCell(row, columnIndexByField.get("code")),
        rawDisplayName: readImportCell(row, columnIndexByField.get("displayName")),
        rawCostPerUnit: readImportCell(row, columnIndexByField.get("costPerUnit")),
        rawDisplayNameEn: readImportCell(row, columnIndexByField.get("displayNameEn")),
    })

    const { validated, issues } = collectZodIssues(candidate, rowNumber)
    if (issues.length > 0 || !validated) {
        accumulators.rowIssues.push(...issues)
        return null
    }
    return finalizeIngredientImportCandidate(validated, rowNumber, accumulators)
}

// Todos los códigos existentes (activos o no), igual que el importador de materias primas.
async function loadExistingIngredientCodes(): Promise<Set<string>> {
    const existingIngredients = await Ingredient.findAll({ attributes: ["code"] })
    return new Set(existingIngredients.map(ingredient => normalizeImportText(ingredient.code)))
}

function validateIngredientImportHeaders(sheet: ExcelJS.Worksheet): Map<IngredientImportField, number> {
    const columnIndexByField = mapImportHeaders(sheet.getRow(1), INGREDIENT_IMPORT_COLUMNS)
    const missingFields = REQUIRED_INGREDIENT_IMPORT_FIELDS.filter(field => !columnIndexByField.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => INGREDIENT_IMPORT_COLUMNS[field].header).join(", ")
        })
    }
    return columnIndexByField
}

async function persistImportedIngredients(candidates: ImportedIngredientCandidate[]): Promise<Ingredient[]> {
    // Libra forzada para todo el archivo, una sola resolución (igual que materias primas).
    const poundUnit = await unitService.findOrCreatePoundUnit()
    const ingredientRecords = candidates.map(({ translations: _translations, urlSlug, ...rest }) => ({ ...rest, urlSlug, costUnitId: poundUnit.id }))
    const createdIngredients = await Ingredient.bulkCreate(ingredientRecords, { returning: true })

    const translationRecords = createdIngredients
        .map((ingredient, index) => {
            const englishName = candidates[index]?.translations?.en?.displayName
            return englishName ? { ingredientId: ingredient.id, language: "en", displayName: englishName } : null
        })
        .filter((record): record is { ingredientId: number; language: string; displayName: string } => record !== null)

    if (translationRecords.length > 0) {
        await IngredientTranslation.bulkCreate(translationRecords)
    }

    return createdIngredients
}

async function bulkImportIngredients(buffer: Buffer): Promise<Ingredient[]> {
    const workbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }
    if (sheet.rowCount - 1 > MAX_INGREDIENT_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_INGREDIENT_IMPORT_ROWS })
    }

    const columnIndexByField = validateIngredientImportHeaders(sheet)
    const accumulators: IngredientImportAccumulators = {
        firstRowByNormalizedName: new Map<string, number>(),
        firstRowByNormalizedCode: new Map<string, number>(),
        existingCodesByNormalized: await loadExistingIngredientCodes(),
        assignedSlugs: new Set<string>(),
        rowIssues: [],
    }

    const candidates: ImportedIngredientCandidate[] = []
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const candidate = await processIngredientImportRow(row, rowNumber, columnIndexByField, accumulators)
        if (candidate) candidates.push(candidate)
    }

    if (accumulators.rowIssues.length > 0) {
        throw new BulkImportError(accumulators.rowIssues)
    }
    if (candidates.length === 0) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    return persistImportedIngredients(candidates)
}

async function buildIngredientImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("Ingredientes")
    sheet.columns = [
        { header: INGREDIENT_IMPORT_COLUMNS.code.header, key: "code", width: 16 },
        { header: INGREDIENT_IMPORT_COLUMNS.displayName.header, key: "displayName", width: 28 },
        { header: INGREDIENT_IMPORT_COLUMNS.costPerUnit.header, key: "costPerUnit", width: 18 },
        { header: INGREDIENT_IMPORT_COLUMNS.displayNameEn.header, key: "displayNameEn", width: 24 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({ code: "SAL-001", displayName: "Sal", costPerUnit: 0.5, displayNameEn: "Salt" })
    sheet.addRow({ code: "AZU-001", displayName: "Azúcar", costPerUnit: 0.75, displayNameEn: "Sugar" })
    sheet.addRow({ code: "PIM-001", displayName: "Pimienta negra", costPerUnit: 6.25, displayNameEn: "" })

    const helpSheet = workbook.addWorksheet("Instrucciones")
    helpSheet.columns = [{ header: "Instrucciones", key: "text", width: 100 }]
    helpSheet.getRow(1).font = { bold: true }
    helpSheet.addRow({ text: `"${INGREDIENT_IMPORT_COLUMNS.code.header}" es un texto libre que tú defines -- debe ser único, no puede repetirse entre ingredientes ni dentro del mismo archivo.` })
    helpSheet.addRow({ text: `"${INGREDIENT_IMPORT_COLUMNS.costPerUnit.header}" siempre es el costo POR LIBRA -- todos los ingredientes se costean en libras.` })
    helpSheet.addRow({ text: "Los ingredientes (sal, azúcar, pimienta...) son distintos de las materias primas: no forman parte del 100% de la receta, se agregan encima como gramos por presentación." })

    return writeWorkbookToBuffer(workbook)
}

export const ingredientService = {
    listIngredients,
    getIngredientById,
    createIngredient,
    updateIngredient,
    deleteIngredient,
    bulkImportIngredients,
    buildIngredientImportTemplate,
}
