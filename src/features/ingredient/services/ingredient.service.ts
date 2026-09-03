import { Op, WhereOptions } from "sequelize"
import ExcelJS from "exceljs"
import Ingredient from "../models/Ingredient.model"
import IngredientTranslation from "../models/IngredientTranslation.model"
import Unit from "../../unit/models/Unit.model"
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
    parseImportBoolean,
    readImportCell,
    writeWorkbookToBuffer,
} from "../../../shared/utils/excelImport.util"
import {
    INGREDIENT_IMPORT_COLUMNS,
    INGREDIENT_IS_MIXABLE_DEFAULT,
    INGREDIENT_IS_ORGANIC_DEFAULT,
    INGREDIENT_TYPE_LABELS,
    INGREDIENT_TYPE_LABEL_TO_KEY,
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

async function createIngredient(input: CreateIngredientInput): Promise<Ingredient> {
    const { translations, ...rest } = input
    const urlSlug = await generateUniqueSlug(rest.displayName, async (candidate) => {
        const existing = await Ingredient.findOne({ where: { urlSlug: candidate } })
        return !!existing
    })
    const ingredient = await Ingredient.create({ ...rest, urlSlug })
    await syncEnglishTranslation(ingredient.id, translations?.en)
    return getIngredientById(ingredient.id)
}

async function updateIngredient(id: number, input: UpdateIngredientInput): Promise<Ingredient> {
    const ingredient = await getIngredientById(id)
    const { translations, ...rest } = input
    await ingredient.update(rest)
    await syncEnglishTranslation(id, translations?.en)
    return getIngredientById(id)
}

async function deleteIngredient(id: number): Promise<void> {
    const ingredient = await getIngredientById(id)
    await ingredient.update({ isActive: false })
}


type IngredientRowValidation = {
    rowNumber: number
    rowIssues: RowIssue[]
    manuallyValidatedFields: Set<string>
}

function resolveIngredientTypeField(rawType: ImportCellValue, ctx: IngredientRowValidation): string | undefined {
    if (rawType === null) return undefined
    const resolvedType = INGREDIENT_TYPE_LABEL_TO_KEY[normalizeImportText(rawType)]
    if (resolvedType) return resolvedType

    ctx.manuallyValidatedFields.add("ingredientType")
    ctx.rowIssues.push({
        row: ctx.rowNumber,
        field: "ingredientType",
        key: "errors.bulk_import_unknown_ingredient_type",
        params: { value: rawType, validValues: Object.values(INGREDIENT_TYPE_LABELS).join(", ") }
    })
    return undefined
}


function resolveIngredientCostUnitField(
    rawCostUnit: ImportCellValue,
    unitsByNormalizedName: Map<string, Unit[]>,
    ctx: IngredientRowValidation
): number | undefined {
    if (rawCostUnit === null) return undefined
    ctx.manuallyValidatedFields.add("costUnitId")

    const matches = unitsByNormalizedName.get(normalizeImportText(rawCostUnit)) ?? []
    if (matches.length === 0) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "costUnitId", key: "errors.bulk_import_unit_not_found", params: { value: rawCostUnit } })
        return undefined
    }
    if (matches.length > 1) {
        ctx.rowIssues.push({ row: ctx.rowNumber, field: "costUnitId", key: "errors.bulk_import_unit_ambiguous", params: { value: rawCostUnit } })
        return undefined
    }
    return matches[0].id
}

function resolveIngredientBooleanField(
    rawValue: ImportCellValue,
    defaultValue: boolean,
    field: "isOrganic" | "isMixable",
    ctx: IngredientRowValidation
): boolean | undefined {
    const resolved = parseImportBoolean(rawValue, defaultValue)
    if (resolved === undefined) {
        ctx.manuallyValidatedFields.add(field)
        ctx.rowIssues.push({ row: ctx.rowNumber, field, key: "errors.bulk_import_invalid_boolean", params: { value: rawValue } })
    }
    return resolved
}

function buildIngredientImportCandidate(fields: {
    rawDisplayName: ImportCellValue
    resolvedType: string | undefined
    resolvedIsOrganic: boolean | undefined
    resolvedIsMixable: boolean | undefined
    rawCostPerUnit: ImportCellValue
    resolvedCostUnitId: number | undefined
    rawDisplayNameEn: ImportCellValue
}) {
    const displayNameEn = typeof fields.rawDisplayNameEn === "string" ? fields.rawDisplayNameEn.trim() : ""
    return {
        displayName: typeof fields.rawDisplayName === "string" ? fields.rawDisplayName.trim() : fields.rawDisplayName,
        ingredientType: fields.resolvedType,
        isOrganic: fields.resolvedIsOrganic,
        isMixable: fields.resolvedIsMixable,
        costPerUnit: fields.rawCostPerUnit === null || fields.rawCostPerUnit === "" ? undefined : Number(fields.rawCostPerUnit),
        costUnitId: fields.resolvedCostUnitId,
        translations: displayNameEn ? { en: { displayName: displayNameEn } } : undefined,
    }
}


function collectZodIssues(
    candidate: unknown,
    manuallyValidatedFields: Set<string>,
    rowNumber: number
): { validated?: CreateIngredientInput; issues: RowIssue[] } {
    const result = createIngredientSchema.safeParse(candidate)
    if (result.success) return { validated: result.data, issues: [] }

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push({ row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return { issues }
}

async function finalizeIngredientImportCandidate(
    validated: CreateIngredientInput,
    rowNumber: number,
    firstRowByNormalizedName: Map<string, number>,
    assignedSlugs: Set<string>,
    rowIssues: RowIssue[]
): Promise<(CreateIngredientInput & { urlSlug: string }) | null> {
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
    unitsByNormalizedName: Map<string, Unit[]>,
    firstRowByNormalizedName: Map<string, number>,
    assignedSlugs: Set<string>,
    rowIssues: RowIssue[]
): Promise<(CreateIngredientInput & { urlSlug: string }) | null> {
    const rawDisplayName = readImportCell(row, columnIndexByField.get("displayName"))
    const rawType = readImportCell(row, columnIndexByField.get("ingredientType"))
    const rawIsOrganic = readImportCell(row, columnIndexByField.get("isOrganic"))
    const rawIsMixable = readImportCell(row, columnIndexByField.get("isMixable"))
    const rawCostPerUnit = readImportCell(row, columnIndexByField.get("costPerUnit"))
    const rawCostUnit = readImportCell(row, columnIndexByField.get("costUnitId"))
    const rawDisplayNameEn = readImportCell(row, columnIndexByField.get("displayNameEn"))

    const ctx: IngredientRowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }

    const resolvedType = resolveIngredientTypeField(rawType, ctx)
    const resolvedCostUnitId = resolveIngredientCostUnitField(rawCostUnit, unitsByNormalizedName, ctx)
    const resolvedIsOrganic = resolveIngredientBooleanField(rawIsOrganic, INGREDIENT_IS_ORGANIC_DEFAULT, "isOrganic", ctx)
    const resolvedIsMixable = resolveIngredientBooleanField(rawIsMixable, INGREDIENT_IS_MIXABLE_DEFAULT, "isMixable", ctx)

    const candidate = buildIngredientImportCandidate({
        rawDisplayName, resolvedType, resolvedIsOrganic, resolvedIsMixable, rawCostPerUnit, resolvedCostUnitId, rawDisplayNameEn
    })

    const { validated, issues: zodIssues } = collectZodIssues(candidate, ctx.manuallyValidatedFields, rowNumber)
    ctx.rowIssues.push(...zodIssues)

    if (ctx.rowIssues.length > 0) {
        rowIssues.push(...ctx.rowIssues)
        return null
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- rowIssues vacío arriba garantiza que zod sí validó
    return finalizeIngredientImportCandidate(validated!, rowNumber, firstRowByNormalizedName, assignedSlugs, rowIssues)
}


async function loadActiveUnitsByNormalizedName(): Promise<Map<string, Unit[]>> {
    const activeUnits = await Unit.findAll({ where: { isActive: true } })
    const unitsByNormalizedName = new Map<string, Unit[]>()
    for (const unit of activeUnits) {
        const key = normalizeImportText(unit.displayName)
        const bucket = unitsByNormalizedName.get(key) ?? []
        bucket.push(unit)
        unitsByNormalizedName.set(key, bucket)
    }
    return unitsByNormalizedName
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


async function persistImportedIngredients(candidates: (CreateIngredientInput & { urlSlug: string })[]): Promise<Ingredient[]> {
    const ingredientRecords = candidates.map(({ translations: _translations, urlSlug, ...rest }) => ({ ...rest, urlSlug }))
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
    const unitsByNormalizedName = await loadActiveUnitsByNormalizedName()

    const rowIssues: RowIssue[] = []

    const candidates: (CreateIngredientInput & { urlSlug: string })[] = []
    const firstRowByNormalizedName = new Map<string, number>()
    const assignedSlugs = new Set<string>()

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const candidate = await processIngredientImportRow(
            row, rowNumber, columnIndexByField, unitsByNormalizedName, firstRowByNormalizedName, assignedSlugs, rowIssues
        )
        if (candidate) candidates.push(candidate)
    }

    if (rowIssues.length > 0) {
        throw new BulkImportError(rowIssues)
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
        { header: INGREDIENT_IMPORT_COLUMNS.displayName.header, key: "displayName", width: 28 },
        { header: INGREDIENT_IMPORT_COLUMNS.ingredientType.header, key: "ingredientType", width: 20 },
        { header: INGREDIENT_IMPORT_COLUMNS.isOrganic.header, key: "isOrganic", width: 26 },
        { header: INGREDIENT_IMPORT_COLUMNS.isMixable.header, key: "isMixable", width: 22 },
        { header: INGREDIENT_IMPORT_COLUMNS.costPerUnit.header, key: "costPerUnit", width: 18 },
        { header: INGREDIENT_IMPORT_COLUMNS.costUnitId.header, key: "costUnitId", width: 18 },
        { header: INGREDIENT_IMPORT_COLUMNS.displayNameEn.header, key: "displayNameEn", width: 24 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({
        displayName: "Piña",
        ingredientType: INGREDIENT_TYPE_LABELS.fruit,
        isOrganic: "No",
        isMixable: "Sí",
        costPerUnit: 20,
        costUnitId: "Kilogramo",
        displayNameEn: "Pineapple"
    })
    sheet.addRow({
        displayName: "Piña Orgánica",
        ingredientType: INGREDIENT_TYPE_LABELS.fruit,
        isOrganic: "Sí",
        isMixable: "Sí",
        costPerUnit: 26.5,
        costUnitId: "Kilogramo",
        displayNameEn: "Organic Pineapple"
    })
    sheet.addRow({
        displayName: "Chocolate Oscuro",
        ingredientType: INGREDIENT_TYPE_LABELS.other,
        isOrganic: "No",
        isMixable: "No",
        costPerUnit: 45,
        costUnitId: "Kilogramo",
        displayNameEn: ""
    })

    const helpSheet = workbook.addWorksheet("Valores permitidos")
    helpSheet.columns = [{ header: `${INGREDIENT_IMPORT_COLUMNS.ingredientType.header} (valores permitidos)`, key: "type", width: 42 }]
    helpSheet.getRow(1).font = { bold: true }
    Object.values(INGREDIENT_TYPE_LABELS).forEach(label => helpSheet.addRow({ type: label }))
    helpSheet.addRow({})
    helpSheet.addRow({ type: `"${INGREDIENT_IMPORT_COLUMNS.costUnitId.header}" debe ser el nombre EXACTO de una Unidad ya creada en el catálogo (ej. "Kilogramo", "Libra") -- ver el módulo de Unidades.` })
    helpSheet.addRow({ type: `"${INGREDIENT_IMPORT_COLUMNS.isOrganic.header}" y "${INGREDIENT_IMPORT_COLUMNS.isMixable.header}" aceptan Sí/No -- vacío toma el valor por defecto (No y Sí respectivamente).` })

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
