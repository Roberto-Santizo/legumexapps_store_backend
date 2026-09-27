import { Op, WhereOptions } from "sequelize"
import ExcelJS from "exceljs"
import RawMaterial from "../models/RawMaterial.model"
import RawMaterialTranslation from "../models/RawMaterialTranslation.model"
import { unitService } from "../../unit/services/unit.service"
import { AppError, BulkImportError, NotFoundError, RowIssue } from "../../../shared/errors/AppError"
import { CreateRawMaterialInput, UpdateRawMaterialInput, RawMaterialTranslationInput, createRawMaterialSchema } from "../schemas/rawMaterial.schema"
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
    RAW_MATERIAL_IMPORT_COLUMNS,
    RAW_MATERIAL_IS_MIXABLE_DEFAULT,
    RAW_MATERIAL_IS_ORGANIC_DEFAULT,
    RAW_MATERIAL_TYPE_LABELS,
    RAW_MATERIAL_TYPE_LABEL_TO_KEY,
    RawMaterialImportField,
    MAX_RAW_MATERIAL_IMPORT_ROWS,
    REQUIRED_RAW_MATERIAL_IMPORT_FIELDS,
} from "../constants/rawMaterialImport.constant"

async function listRawMaterials(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<RawMaterial>> {
    const where: WhereOptions = { isActive: true, ...(search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}) }
    return paginate(
        RawMaterial,
        { where, order: [["displayName", "DESC"]], include: [{ model: RawMaterialTranslation, as: "translations" }] },
        pagination
    )
}

async function getRawMaterialById(id: number): Promise<RawMaterial> {
    const rawMaterial = await RawMaterial.findOne({
        where: { id, isActive: true },
        include: [{ model: RawMaterialTranslation, as: "translations" }]
    })
    if (!rawMaterial) throw new NotFoundError("RawMaterial", id)
    return rawMaterial
}

async function syncEnglishTranslation(rawMaterialId: number, en: RawMaterialTranslationInput | undefined): Promise<void> {
    if (!en?.displayName) return
    const [translation] = await RawMaterialTranslation.findOrCreate({
        where: { rawMaterialId, language: "en" },
        defaults: { rawMaterialId, language: "en", displayName: en.displayName }
    })
    await translation.update({ displayName: en.displayName })
}

// El código es manual (nunca se autogenera, a diferencia de urlSlug) y único -- se rechaza con
// un error de negocio claro ANTES de llegar al unique constraint de la columna (que daría el
// 409 genérico "errors.unique_constraint" vía errorHandler, menos útil para el admin).
async function assertCodeIsUnique(code: string, excludeId?: number): Promise<void> {
    const where: WhereOptions = excludeId ? { code, id: { [Op.ne]: excludeId } } : { code }
    const existing = await RawMaterial.findOne({ where })
    if (existing) throw new AppError(409, "errors.raw_material_code_already_exists", { code })
}

async function createRawMaterial(input: CreateRawMaterialInput): Promise<RawMaterial> {
    const { translations, ...rest } = input
    await assertCodeIsUnique(rest.code)
    const urlSlug = await generateUniqueSlug(rest.displayName, async (candidate) => {
        const existing = await RawMaterial.findOne({ where: { urlSlug: candidate } })
        return !!existing
    })
    const poundUnit = await unitService.findOrCreatePoundUnit()
    const rawMaterial = await RawMaterial.create({ ...rest, urlSlug, costUnitId: poundUnit.id })
    await syncEnglishTranslation(rawMaterial.id, translations?.en)
    return getRawMaterialById(rawMaterial.id)
}

async function updateRawMaterial(id: number, input: UpdateRawMaterialInput): Promise<RawMaterial> {
    const rawMaterial = await getRawMaterialById(id)
    const { translations, ...rest } = input
    if (rest.code) await assertCodeIsUnique(rest.code, id)
    const poundUnit = await unitService.findOrCreatePoundUnit()
    await rawMaterial.update({ ...rest, costUnitId: poundUnit.id })
    await syncEnglishTranslation(id, translations?.en)
    return getRawMaterialById(id)
}

async function deleteRawMaterial(id: number): Promise<void> {
    const rawMaterial = await getRawMaterialById(id)
    await rawMaterial.update({ isActive: false })
}


type RawMaterialRowValidation = {
    rowNumber: number
    rowIssues: RowIssue[]
    manuallyValidatedFields: Set<string>
}


type RawMaterialImportAccumulators = {
    firstRowByNormalizedName: Map<string, number>
    firstRowByNormalizedCode: Map<string, number>
    existingCodesByNormalized: Set<string>
    assignedSlugs: Set<string>
    rowIssues: RowIssue[]
}

function resolveRawMaterialTypeField(rawType: ImportCellValue, ctx: RawMaterialRowValidation): string | undefined {
    if (rawType === null) return undefined
    const resolvedType = RAW_MATERIAL_TYPE_LABEL_TO_KEY[normalizeImportText(rawType)]
    if (resolvedType) return resolvedType

    ctx.manuallyValidatedFields.add("ingredientType")
    ctx.rowIssues.push({
        row: ctx.rowNumber,
        field: "ingredientType",
        key: "errors.bulk_import_unknown_raw_material_type",
        params: { value: rawType, validValues: Object.values(RAW_MATERIAL_TYPE_LABELS).join(", ") }
    })
    return undefined
}


function resolveRawMaterialBooleanField(
    rawValue: ImportCellValue,
    defaultValue: boolean,
    field: "isOrganic" | "isMixable",
    ctx: RawMaterialRowValidation
): boolean | undefined {
    const resolved = parseImportBoolean(rawValue, defaultValue)
    if (resolved === undefined) {
        ctx.manuallyValidatedFields.add(field)
        ctx.rowIssues.push({ row: ctx.rowNumber, field, key: "errors.bulk_import_invalid_boolean", params: { value: rawValue } })
    }
    return resolved
}

function buildRawMaterialImportCandidate(fields: {
    rawCode: ImportCellValue
    rawDisplayName: ImportCellValue
    resolvedType: string | undefined
    resolvedIsOrganic: boolean | undefined
    resolvedIsMixable: boolean | undefined
    rawCostPerUnit: ImportCellValue
    rawDisplayNameEn: ImportCellValue
}) {
    const displayNameEn = typeof fields.rawDisplayNameEn === "string" ? fields.rawDisplayNameEn.trim() : ""
    return {
        // String(...) y no el mismo trim condicional que displayName: un código como "007" o
        // "12345" entrado sin formato de texto en Excel llega como number -- hay que forzarlo a
        // string siempre para no perder ceros a la izquierda ni romper el schema (code es string).
        code: fields.rawCode === null ? fields.rawCode : String(fields.rawCode).trim(),
        displayName: typeof fields.rawDisplayName === "string" ? fields.rawDisplayName.trim() : fields.rawDisplayName,
        ingredientType: fields.resolvedType,
        isOrganic: fields.resolvedIsOrganic,
        isMixable: fields.resolvedIsMixable,
        costPerUnit: fields.rawCostPerUnit === null || fields.rawCostPerUnit === "" ? undefined : Number(fields.rawCostPerUnit),
        translations: displayNameEn ? { en: { displayName: displayNameEn } } : undefined,
    }
}


function collectZodIssues(
    candidate: unknown,
    manuallyValidatedFields: Set<string>,
    rowNumber: number
): { validated?: CreateRawMaterialInput; issues: RowIssue[] } {
    const result = createRawMaterialSchema.safeParse(candidate)
    if (result.success) return { validated: result.data, issues: [] }

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push({ row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return { issues }
}

async function finalizeRawMaterialImportCandidate(
    validated: CreateRawMaterialInput,
    rowNumber: number,
    accumulators: RawMaterialImportAccumulators
): Promise<(CreateRawMaterialInput & { urlSlug: string }) | null> {
    const { firstRowByNormalizedName, firstRowByNormalizedCode, existingCodesByNormalized, assignedSlugs, rowIssues } = accumulators

    // A diferencia de displayName (no es único a nivel de columna, solo se revisa dentro del
    // archivo), code SÍ es único en la BD -- se reportan ambos problemas si aplican, en vez de
    // cortar en el primero, para que el admin vea todos los errores de la fila de una vez.
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
            key: "errors.raw_material_code_already_exists",
            params: { code: validated.code }
        })
        hasIssue = true
    }

    if (hasIssue) return null

    firstRowByNormalizedName.set(normalizedName, rowNumber)
    firstRowByNormalizedCode.set(normalizedCode, rowNumber)

    const urlSlug = await generateUniqueSlug(validated.displayName, async (candidateSlug) => {
        if (assignedSlugs.has(candidateSlug)) return true
        const existing = await RawMaterial.findOne({ where: { urlSlug: candidateSlug } })
        return !!existing
    })
    assignedSlugs.add(urlSlug)

    return { ...validated, urlSlug }
}


async function processRawMaterialImportRow(
    row: ExcelJS.Row,
    rowNumber: number,
    columnIndexByField: Map<RawMaterialImportField, number>,
    accumulators: RawMaterialImportAccumulators
): Promise<(CreateRawMaterialInput & { urlSlug: string }) | null> {
    const rawCode = readImportCell(row, columnIndexByField.get("code"))
    const rawDisplayName = readImportCell(row, columnIndexByField.get("displayName"))
    const rawType = readImportCell(row, columnIndexByField.get("ingredientType"))
    const rawIsOrganic = readImportCell(row, columnIndexByField.get("isOrganic"))
    const rawIsMixable = readImportCell(row, columnIndexByField.get("isMixable"))
    const rawCostPerUnit = readImportCell(row, columnIndexByField.get("costPerUnit"))
    const rawDisplayNameEn = readImportCell(row, columnIndexByField.get("displayNameEn"))

    const ctx: RawMaterialRowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }

    const resolvedType = resolveRawMaterialTypeField(rawType, ctx)
    const resolvedIsOrganic = resolveRawMaterialBooleanField(rawIsOrganic, RAW_MATERIAL_IS_ORGANIC_DEFAULT, "isOrganic", ctx)
    const resolvedIsMixable = resolveRawMaterialBooleanField(rawIsMixable, RAW_MATERIAL_IS_MIXABLE_DEFAULT, "isMixable", ctx)

    const candidate = buildRawMaterialImportCandidate({
        rawCode, rawDisplayName, resolvedType, resolvedIsOrganic, resolvedIsMixable, rawCostPerUnit, rawDisplayNameEn
    })

    const { validated, issues: zodIssues } = collectZodIssues(candidate, ctx.manuallyValidatedFields, rowNumber)
    ctx.rowIssues.push(...zodIssues)

    if (ctx.rowIssues.length > 0) {
        accumulators.rowIssues.push(...ctx.rowIssues)
        return null
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- rowIssues vacío arriba garantiza que zod sí validó
    return finalizeRawMaterialImportCandidate(validated!, rowNumber, accumulators)
}


// Preload de todos los códigos de materia prima ya existentes (activos o no -- mismo criterio
// que el chequeo de urlSlug de arriba, que tampoco filtra por isActive) para poder rechazar
// duplicados-contra-la-BD con un RowIssue claro ANTES de intentar el bulkCreate, en vez de dejar
// que Postgres reviente el batch completo con una violación de unique constraint genérica.
async function loadExistingRawMaterialCodes(): Promise<Set<string>> {
    const existingRawMaterials = await RawMaterial.findAll({ attributes: ["code"] })
    return new Set(existingRawMaterials.map(rawMaterial => normalizeImportText(rawMaterial.code)))
}

function validateRawMaterialImportHeaders(sheet: ExcelJS.Worksheet): Map<RawMaterialImportField, number> {
    const columnIndexByField = mapImportHeaders(sheet.getRow(1), RAW_MATERIAL_IMPORT_COLUMNS)
    const missingFields = REQUIRED_RAW_MATERIAL_IMPORT_FIELDS.filter(field => !columnIndexByField.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => RAW_MATERIAL_IMPORT_COLUMNS[field].header).join(", ")
        })
    }
    return columnIndexByField
}


async function persistImportedRawMaterials(candidates: (CreateRawMaterialInput & { urlSlug: string })[]): Promise<RawMaterial[]> {
    // Unidad de costeo forzada a Libra para TODA la fila, igual que create/update individual --
    // ver findOrCreatePoundUnit. Una sola resolución para todo el archivo (no por fila).
    const poundUnit = await unitService.findOrCreatePoundUnit()
    const rawMaterialRecords = candidates.map(({ translations: _translations, urlSlug, ...rest }) => ({ ...rest, urlSlug, costUnitId: poundUnit.id }))
    const createdRawMaterials = await RawMaterial.bulkCreate(rawMaterialRecords, { returning: true })

    const translationRecords = createdRawMaterials
        .map((rawMaterial, index) => {
            const englishName = candidates[index]?.translations?.en?.displayName
            return englishName ? { rawMaterialId: rawMaterial.id, language: "en", displayName: englishName } : null
        })
        .filter((record): record is { rawMaterialId: number; language: string; displayName: string } => record !== null)

    if (translationRecords.length > 0) {
        await RawMaterialTranslation.bulkCreate(translationRecords)
    }

    return createdRawMaterials
}


async function bulkImportRawMaterials(buffer: Buffer): Promise<RawMaterial[]> {
    const workbook = await loadWorkbookFromBuffer(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }
    if (sheet.rowCount - 1 > MAX_RAW_MATERIAL_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_RAW_MATERIAL_IMPORT_ROWS })
    }

    const columnIndexByField = validateRawMaterialImportHeaders(sheet)
    const existingCodesByNormalized = await loadExistingRawMaterialCodes()

    const accumulators: RawMaterialImportAccumulators = {
        firstRowByNormalizedName: new Map<string, number>(),
        firstRowByNormalizedCode: new Map<string, number>(),
        existingCodesByNormalized,
        assignedSlugs: new Set<string>(),
        rowIssues: [],
    }

    const candidates: (CreateRawMaterialInput & { urlSlug: string })[] = []

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columnIndexByField)) continue

        const candidate = await processRawMaterialImportRow(row, rowNumber, columnIndexByField, accumulators)
        if (candidate) candidates.push(candidate)
    }

    if (accumulators.rowIssues.length > 0) {
        throw new BulkImportError(accumulators.rowIssues)
    }
    if (candidates.length === 0) {
        throw new AppError(422, "errors.bulk_import_empty_file")
    }

    return persistImportedRawMaterials(candidates)
}


async function buildRawMaterialImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("Materias Primas")
    sheet.columns = [
        // "Código" va PRIMERO a propósito (columna de identificación de la materia prima) -- el
        // parser en sí no depende del orden físico de columnas (mapImportHeaders matchea por
        // nombre de encabezado), pero la plantilla descargable sí debe mostrarlo primero.
        { header: RAW_MATERIAL_IMPORT_COLUMNS.code.header, key: "code", width: 16 },
        { header: RAW_MATERIAL_IMPORT_COLUMNS.displayName.header, key: "displayName", width: 28 },
        { header: RAW_MATERIAL_IMPORT_COLUMNS.ingredientType.header, key: "ingredientType", width: 20 },
        { header: RAW_MATERIAL_IMPORT_COLUMNS.isOrganic.header, key: "isOrganic", width: 26 },
        { header: RAW_MATERIAL_IMPORT_COLUMNS.isMixable.header, key: "isMixable", width: 22 },
        { header: RAW_MATERIAL_IMPORT_COLUMNS.costPerUnit.header, key: "costPerUnit", width: 18 },
        { header: RAW_MATERIAL_IMPORT_COLUMNS.displayNameEn.header, key: "displayNameEn", width: 24 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({
        code: "PIN-001",
        displayName: "Piña",
        ingredientType: RAW_MATERIAL_TYPE_LABELS.fruit,
        isOrganic: "No",
        isMixable: "Sí",
        costPerUnit: 9.5,
        displayNameEn: "Pineapple"
    })
    sheet.addRow({
        code: "PIN-002",
        displayName: "Piña Orgánica",
        ingredientType: RAW_MATERIAL_TYPE_LABELS.fruit,
        isOrganic: "Sí",
        isMixable: "Sí",
        costPerUnit: 12.25,
        displayNameEn: "Organic Pineapple"
    })
    sheet.addRow({
        code: "CHO-001",
        displayName: "Chocolate Oscuro",
        ingredientType: RAW_MATERIAL_TYPE_LABELS.other,
        isOrganic: "No",
        isMixable: "No",
        costPerUnit: 20.5,
        displayNameEn: ""
    })

    const helpSheet = workbook.addWorksheet("Valores permitidos")
    helpSheet.columns = [{ header: `${RAW_MATERIAL_IMPORT_COLUMNS.ingredientType.header} (valores permitidos)`, key: "type", width: 42 }]
    helpSheet.getRow(1).font = { bold: true }
    Object.values(RAW_MATERIAL_TYPE_LABELS).forEach(label => helpSheet.addRow({ type: label }))
    helpSheet.addRow({})
    helpSheet.addRow({ type: `"${RAW_MATERIAL_IMPORT_COLUMNS.code.header}" es un texto libre (letras, números y símbolos) que tú defines -- debe ser único, no puede repetirse entre materias primas ni dentro del mismo archivo.` })
    helpSheet.addRow({ type: `"${RAW_MATERIAL_IMPORT_COLUMNS.costPerUnit.header}" siempre es el costo POR LIBRA -- la unidad de costeo ya no se elige, todas las materias primas se costean en libras.` })
    helpSheet.addRow({ type: `"${RAW_MATERIAL_IMPORT_COLUMNS.isOrganic.header}" y "${RAW_MATERIAL_IMPORT_COLUMNS.isMixable.header}" aceptan Sí/No -- vacío toma el valor por defecto (No y Sí respectivamente).` })

    return writeWorkbookToBuffer(workbook)
}

export const rawMaterialService = {
    listRawMaterials,
    getRawMaterialById,
    createRawMaterial,
    updateRawMaterial,
    deleteRawMaterial,
    bulkImportRawMaterials,
    buildRawMaterialImportTemplate,
}
