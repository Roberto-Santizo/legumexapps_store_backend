import type { ParsedWorkbook, ParsedRow, ParsedWorksheet } from "../../../shared/utils/parsedWorkbook"
import { Op, Transaction, WhereOptions } from "sequelize"
import ExcelJS from "exceljs"
import Packaging from "../models/Packaging.model"
import { lockGenericCodes, nextGenericCodes } from "./packagingCode.service"
import { PACKAGING_MATERIAL_TYPES, PALLET_MATERIAL_TYPES, fixedPalletConsumption, type PalletMaterialType } from "../constants/packagingMaterialType.constant"
import PalletKitMaterial from "../../palletKit/models/PalletKitMaterial.model"
import { AppError, BulkImportError, NotFoundError, RowIssue } from "../../../shared/errors/AppError"
import { CreatePackagingInput, PackagingImportInput, UpdatePackagingInput, packagingDefaultsSchema, PackagingQuery, importLegacyPackagingSchema } from "../schemas/packaging.schema"
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

async function listPackagings(pagination?: PaginationParams, search?: string, filters: Partial<PackagingQuery> = {}): Promise<PaginatedResult<Packaging>> {
    const where: WhereOptions = {
        ...(filters.status === "all" ? {} : { isActive: filters.status !== "inactive" }),
        ...(filters.classification ? { classification: filters.classification } : {}),
        ...(filters.packagingRole ? { packagingRole: filters.packagingRole } : {}),
        ...(search ? {
            [Op.or]: [
                { displayName: { [Op.iLike]: `%${search}%` } },
                { displayNameEn: { [Op.iLike]: `%${search}%` } },
                { code: { [Op.iLike]: `%${search}%` } },
            ],
        } : {}),
    }
    // Newest first; id breaks ties between rows created together by a bulk import.
    return paginate(Packaging, { where, order: [["createdAt", "DESC"], ["id", "DESC"]] }, pagination)
}

async function getPackagingById(id: number): Promise<Packaging> {
    const packaging = await Packaging.findOne({ where: { id } })
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
    if (input.classification !== "generic") {
        await assertCodeIsUnique(input.code!)
        return Packaging.create(resolveMaterialType(input))
    }
    return Packaging.sequelize!.transaction(async transaction => {
        await lockGenericCodes(transaction)
        const [code] = await nextGenericCodes(input.packagingRole, 1, transaction)
        return Packaging.create({ ...resolveMaterialType(input), code }, { transaction })
    })
}

// The stored type and its catalog consumption. Unit and intermediate materials take the level's type; pallet
// materials need one: fixed types (caja, tarima, esquinero, stretch) take their rule, OTRO is set per association.
// Editing a pallet material without sending a type keeps its type and consumption.
function resolveMaterialType<T extends UpdatePackagingInput>(input: T, current?: Packaging) {
    const { materialType, ...values } = input
    if (input.packagingRole === "unit") return { ...values, materialType: "INDIVIDUAL" as const, defaultQuantityBasis: null, defaultQuantityValue: null }
    if (input.packagingRole === "intermediate") return { ...values, materialType: "INTERMEDIO" as const, defaultQuantityBasis: null, defaultQuantityValue: null }
    const keep = !materialType && current?.packagingRole === "pallet"
    const type = (materialType ?? (keep ? current.materialType : undefined)) as PalletMaterialType | undefined
    if (!type || !PALLET_MATERIAL_TYPES.includes(type)) throw new AppError(422, "errors.packaging_import_material_type")
    if (keep || type === "OTRO") return { ...values, materialType: type }
    return { ...values, materialType: type, ...fixedPalletConsumption(type) }
}

// A kit material must stay an active generic pallet material of its kit type while it is in the kit.
async function assertKitMembershipKept(packaging: Packaging, next: { classification?: string; packagingRole?: string; materialType?: string; isActive?: boolean }) {
    const leavesKitShape = (next.classification ?? packaging.classification) !== "generic" || (next.packagingRole ?? packaging.packagingRole) !== "pallet"
        || (next.materialType ?? packaging.materialType) !== packaging.materialType || next.isActive === false
    if (leavesKitShape && await PalletKitMaterial.findOne({ where: { packagingId: packaging.id } })) throw new AppError(422, "errors.packaging_in_pallet_kit")
}

async function updatePackaging(id: number, input: UpdatePackagingInput): Promise<Packaging> {
    const packaging = await getPackagingById(id)
    const classification = input.classification ?? packaging.classification
    if (classification === "generic") {
        if (input.code && input.code !== packaging.code) throw new AppError(422, "errors.packaging_generic_code_forbidden")
        // Becoming generic, or changing level, takes a new code of the level's pattern.
        if (packaging.classification !== "generic" || input.packagingRole !== packaging.packagingRole) {
            return Packaging.sequelize!.transaction(async transaction => {
                await lockGenericCodes(transaction)
                const [code] = await nextGenericCodes(input.packagingRole, 1, transaction)
                return applyPackagingUpdate(packaging, { ...input, code }, transaction)
            })
        }
        return applyPackagingUpdate(packaging, { ...input, code: packaging.code })
    }
    if (!input.code) throw new AppError(422, "errors.packaging_code_required")
    await assertCodeIsUnique(input.code, id)
    return applyPackagingUpdate(packaging, input)
}

async function applyPackagingUpdate(packaging: Packaging, input: UpdatePackagingInput, transaction?: Transaction): Promise<Packaging> {
    const values = resolveMaterialType(input, packaging)
    await assertKitMembershipKept(packaging, values)
    const effective = packagingDefaultsSchema.safeParse({ defaultQuantityBasis: packaging.defaultQuantityBasis, defaultQuantityValue: packaging.defaultQuantityValue == null ? null : Number(packaging.defaultQuantityValue), ...values })
    if (!effective.success) throw new AppError(422, "errors.packaging_consumption_defaults")
    const changes = { ...values, ...(input.displayNameEn !== undefined ? { displayNameEn: input.displayNameEn?.trim() || null } : {}) }
    return transaction ? packaging.update(changes, { transaction }) : packaging.update(changes)
}

async function deletePackaging(id: number): Promise<void> {
    const packaging = await getPackagingById(id)
    await assertKitMembershipKept(packaging, { isActive: false })
    await packaging.update({ isActive: false })
}

// Defensa en profundidad: un packagingId de otro rol (ej. un material de palet como empaque
// individual) se rechaza aunque venga por fuera de la UI, porque alimenta el cálculo.
async function assertPackagingHasRole(packagingId: number, expectedRole: string): Promise<Packaging> {
    const packaging = await getPackagingById(packagingId)
    if (!packaging.isActive) throw new NotFoundError("Packaging", packagingId)
    if (packaging.classification === "generic") throw new AppError(422, "errors.packaging_generic_not_available")
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
        code: fields.rawCode === null || String(fields.rawCode).trim() === "" ? undefined : String(fields.rawCode).trim(),
        displayName: typeof fields.rawDisplayName === "string" ? fields.rawDisplayName.trim() : fields.rawDisplayName,
        packagingRole: fields.resolvedRole,
        unitCost: fields.rawUnitCost === null || fields.rawUnitCost === "" ? undefined : Number(fields.rawUnitCost),
    }
}

function collectPackagingZodIssues(
    candidate: unknown,
    manuallyValidatedFields: Set<string>,
    rowNumber: number
): { validated?: PackagingImportInput; issues: RowIssue[] } {
    const result = importLegacyPackagingSchema.safeParse(candidate)
    if (result.success) return { validated: result.data, issues: [] }

    const issues: RowIssue[] = []
    for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "row"
        if (manuallyValidatedFields.has(field)) continue
        issues.push(issue.message.startsWith("errors.") ? { row: rowNumber, field, key: issue.message } : { row: rowNumber, field, key: `errors.zod.${issue.code}`, params: { defaultValue: issue.message } })
    }
    return { issues }
}


function finalizePackagingImportCandidate(
    validated: PackagingImportInput,
    rowNumber: number,
    firstRowByNormalizedName: Map<string, number>,
    firstRowByNormalizedCode: Map<string, number>,
    existingCodesByNormalized: Set<string>,
    rowIssues: RowIssue[]
): PackagingImportInput | null {
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

    // Generic rows have no code yet: the system assigns it when saving.
    const normalizedCode = validated.code ? normalizeImportText(validated.code) : ""
    const firstCodeRow = normalizedCode ? firstRowByNormalizedCode.get(normalizedCode) : undefined
    if (firstCodeRow) {
        rowIssues.push({
            row: rowNumber,
            field: "code",
            key: "errors.bulk_import_duplicate_code_in_file",
            params: { code: validated.code, firstRow: firstCodeRow }
        })
        hasIssue = true
    } else if (normalizedCode && existingCodesByNormalized.has(normalizedCode)) {
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
    if (normalizedCode) firstRowByNormalizedCode.set(normalizedCode, rowNumber)
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
): PackagingImportInput | null {
    const rawCode = readImportCell(row, columnIndexByField.get("code"))
    const rawDisplayName = readImportCell(row, columnIndexByField.get("displayName"))
    const rawRole = readImportCell(row, columnIndexByField.get("packagingRole"))
    const rawUnitCost = readImportCell(row, columnIndexByField.get("unitCost"))

    const ctx: PackagingRowValidation = { rowNumber, rowIssues: [], manuallyValidatedFields: new Set<string>() }

    const resolvedRole = resolvePackagingRoleField(rawRole, ctx)
    const baseCandidate = buildPackagingImportCandidate({ rawCode, rawDisplayName, resolvedRole, rawUnitCost })
    const rawClassification = readImportCell(row, columnIndexByField.get("classification"))
    const classificationKey = rawClassification == null || String(rawClassification).trim() === "" ? "specific" : normalizeImportText(String(rawClassification))
    const classifications: Record<string, string> = { specific: "specific", especifico: "specific", especificos: "specific", "especifico de cliente": "specific", generic: "generic", generico: "generic", genericos: "generic" }
    const rawNameEn = readImportCell(row, columnIndexByField.get("displayNameEn"))
    const displayNameEn = rawNameEn == null || String(rawNameEn).trim() === "" ? null : typeof rawNameEn === "string" ? rawNameEn.trim() : rawNameEn
    if (columnIndexByField.has("displayNameEn") && displayNameEn === null) ctx.rowIssues.push({ row: rowNumber, field: "displayNameEn", key: "errors.packaging_english_name_required" })
    // Pallet rows need their type (CAJA, TARIMA, ESQUINERO, STRETCH or OTRO); unit and intermediate rows may leave
    // it empty because it follows the level. Fixed types take their catalog consumption.
    const rawType = readImportCell(row, columnIndexByField.get("materialType"))
    const typeKey = rawType == null || String(rawType).trim() === "" ? "" : normalizeImportText(String(rawType))
    const declaredType = PACKAGING_MATERIAL_TYPES.find(type => normalizeImportText(type) === typeKey) ?? (typeKey === normalizeImportText("OTRO PALETIZACIÓN") ? "OTRO" : undefined)
    const levelType = resolvedRole === "unit" ? "INDIVIDUAL" : resolvedRole === "intermediate" ? "INTERMEDIO" : undefined
    const palletType = resolvedRole === "pallet" && PALLET_MATERIAL_TYPES.includes(declaredType as PalletMaterialType) ? declaredType as PalletMaterialType : undefined
    if (resolvedRole && (resolvedRole === "pallet" ? !palletType : typeKey && declaredType !== levelType)) {
        ctx.rowIssues.push({ row: rowNumber, field: "materialType", key: "errors.packaging_import_material_type" })
    }
    const candidate = { ...baseCandidate, displayNameEn, classification: classifications[classificationKey] ?? classificationKey, materialType: palletType ?? levelType,
        ...(palletType && palletType !== "OTRO" ? fixedPalletConsumption(palletType) : {}) }
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
    const candidates: PackagingImportInput[] = []
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

    if (!candidates.some(row => row.classification === "generic")) return Packaging.bulkCreate(candidates)
    return Packaging.sequelize!.transaction(async transaction => {
        await lockGenericCodes(transaction)
        const codes = new Map<string, string[]>()
        for (const role of new Set(candidates.filter(row => row.classification === "generic").map(row => row.packagingRole)))
            codes.set(role, await nextGenericCodes(role, candidates.filter(row => row.classification === "generic" && row.packagingRole === role).length, transaction))
        return Packaging.bulkCreate(candidates.map(row => row.classification === "generic" ? { ...row, code: codes.get(row.packagingRole)!.shift() } : row), { transaction })
    })
}

async function buildPackagingImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const sheet = workbook.addWorksheet("Empaques")
    sheet.columns = [
        // "Código" va primero en la plantilla; el parser mapea por nombre de encabezado, no por posición.
        { header: PACKAGING_IMPORT_COLUMNS.classification.header, key: "classification", width: 25 },
        { header: PACKAGING_IMPORT_COLUMNS.code.header, key: "code", width: 16 },
        { header: PACKAGING_IMPORT_COLUMNS.displayNameEn.header, key: "displayNameEn", width: 32 },
        { header: PACKAGING_IMPORT_COLUMNS.displayName.header, key: "displayName", width: 32 },
        { header: PACKAGING_IMPORT_COLUMNS.packagingRole.header, key: "packagingRole", width: 34 },
        { header: PACKAGING_IMPORT_COLUMNS.unitCost.header, key: "unitCost", width: 20 },
        { header: PACKAGING_IMPORT_COLUMNS.materialType.header, key: "materialType", width: 24 },
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
        unitCost: 2
    })

    for (const [code, displayName] of [["ESQ-001", "Esquinero"], ["TAR-001", "Tarima"], ["STR-001", "Stretch"]] as const) {
        sheet.addRow({ code, displayName, packagingRole: PACKAGING_ROLE_LABELS.pallet, unitCost: 0 })
    }
    for (let row = 2; row <= sheet.rowCount; row++) {
        sheet.getRow(row).getCell("classification").value = "Específico de cliente"
        sheet.getRow(row).getCell("materialType").value = ["INDIVIDUAL", "INTERMEDIO", "CAJA", "ESQUINERO", "TARIMA", "STRETCH"][row - 2]
        sheet.getRow(row).getCell("displayNameEn").value = ["Bag", "Intermediate bag", "Master carton", "Corner protector", "Pallet", "Stretch film"][row - 2]
    }
    // Generic example: the code stays empty, the system assigns GEN-IND-0001 style codes.
    sheet.addRow({ classification: "Genérico", displayName: "Bolsa genérica con zipper", displayNameEn: "Generic zipper bag", packagingRole: PACKAGING_ROLE_LABELS.unit, unitCost: 0.1, materialType: "INDIVIDUAL" })
    for (let row = 2; row <= MAX_PACKAGING_IMPORT_ROWS + 1; row++) {
        sheet.getRow(row).getCell("materialType").dataValidation = { type: "list", allowBlank: true, formulae: ['"INDIVIDUAL,INTERMEDIO,CAJA,ESQUINERO,TARIMA,STRETCH,OTRO"'] }
        sheet.getRow(row).getCell("classification").dataValidation = { type: "list", allowBlank: true, formulae: ['"Específico de cliente,Genérico"'] }
    }

    const helpSheet = workbook.addWorksheet("Valores permitidos")
    helpSheet.columns = [{ header: `${PACKAGING_IMPORT_COLUMNS.packagingRole.header} (valores permitidos)`, key: "role", width: 42 }]
    helpSheet.getRow(1).font = { bold: true }
    Object.values(PACKAGING_ROLE_LABELS).forEach(label => helpSheet.addRow({ role: label }))
    helpSheet.addRow({})
    helpSheet.addRow({ role: "Clasificación: Específico de cliente (material destinado a productos de clientes) o Genérico (material para configuraciones genéricas de productos nuevos). Columna ausente o celda vacía: Específico de cliente. Se aceptan los valores de plantillas anteriores. El código es interno, no requiere ERP." })
    helpSheet.addRow({ role: `"${PACKAGING_IMPORT_COLUMNS.code.header}": obligatorio para materiales Específicos (el código que ya tiene el material del cliente; único, no puede repetirse). Para materiales Genéricos déjelo vacío: el sistema asigna GEN-IND-0001 (individual), GEN-INT-0001 (intermedio) o GEN-PAL-0001 (paletización).` })

    helpSheet.addRow({ role: "Tipo de material: obligatorio para materiales de paletización (CAJA = 1 por caja de la variante; ESQUINERO = 4, TARIMA = 1 y STRETCH = 93.3 metros por pallet; OTRO = consumo definido en cada SKU, p. ej. fleje). En empaque individual e intermedio puede quedar vacío: se asigna solo. El costo del stretch debe ser por metro. El tipo no se deduce del nombre." })
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
