import type { ParsedWorksheet, ParsedWorkbook } from "../../../shared/utils/parsedWorkbook"
import ExcelJS from "exceljs"
import { UniqueConstraintError } from "sequelize"
import { z } from "zod"
import sequelize from "../../../database/connection"
import { AppError, BulkImportError, RowIssue } from "../../../shared/errors/AppError"
import { loadWorkbookFromBuffer, writeWorkbookToBuffer, mapImportHeaders, readImportCell, normalizeImportText, isImportRowBlank } from "../../../shared/utils/excelImport.util"
import { toDecimal } from "../../../shared/utils/money.util"
import { generateUniqueSlug } from "../../../shared/utils/slug.util"
import Client from "../../client/models/Client.model"
import Juice from "../models/Juice.model"
import Raw from "../models/JuiceRawMaterial.model"
import SpiceMaterial from "../models/JuiceSpiceMaterial.model"
import Mix from "../models/JuiceMix.model"
import Spice from "../models/JuiceSpice.model"
import Presentation from "../models/JuicePresentation.model"
import Global from "../models/JuiceCostConstants.model"
import Override from "../models/JuiceClientConstantOverride.model"
import * as schemas from "../schemas/juice.schema"
import { JUICE_IMPORT_SHEETS as names, JUICE_MATERIAL_HEADERS, JUICE_PRESENTATION_HEADERS, MAX_JUICE_IMPORT_ROWS, MAX_JUICE_IMPORT_COLUMNS, juiceImportColumns } from "../constants/juiceImport.constant"

type RawInput = z.infer<typeof schemas.createJuiceRawMaterialSchema>
type SpiceInput = z.infer<typeof schemas.createJuiceSpiceMaterialSchema>
type PresentationInput = z.infer<typeof schemas.createJuicePresentationSchema>
type Ref = { id?: number; code: string; displayName: string; isActive: boolean }
type Material = { row: number; kind: "raw"; input: RawInput; ref: Ref } | { row: number; kind: "spice"; input: SpiceInput; ref: Ref }
type Formula = { column: number; ref: Ref; clientId: number; price?: number; liquids: { ref: Ref; percentage: number; row: number }[]; spices: { ref: Ref; grams: number; row: number }[] }
type Physical = { row: number; ref: Ref; input: Omit<PresentationInput, "juiceId">; price: number }
const codeKey = (value: string) => value.trim().toLowerCase()
const text = (value: unknown) => value === null || value === undefined ? "" : String(value).trim()
const numeric = (value: unknown) => value === null || value === undefined || text(value) === "" ? undefined : Number(value)

function sheet(workbook: ParsedWorkbook, name: string): ParsedWorksheet {
    const matches = workbook.worksheets.filter(row => normalizeImportText(row.name) === normalizeImportText(name))
    if (matches.length !== 1) throw new AppError(422, "errors.juice_import_sheet", { sheet: name })
    if (matches[0].rowCount > MAX_JUICE_IMPORT_ROWS + 1) throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_JUICE_IMPORT_ROWS })
    return matches[0]
}

function headers<T extends string>(worksheet: ParsedWorksheet, definitions: Record<T, string>) {
    const columns = juiceImportColumns(definitions)
    const mapped = mapImportHeaders(worksheet.getRow(1), columns)
    const missing = (Object.keys(definitions) as T[]).filter(key => !mapped.has(key))
    if (missing.length) throw new AppError(422, "errors.bulk_import_missing_columns", { columns: `${worksheet.name}: ${missing.map(key => definitions[key]).join(", ")}` })
    const seen = new Set<T>()
    worksheet.getRow(1).eachCell((_cell, column) => {
        const key = (Object.keys(columns) as T[]).find(field => columns[field].aliases.includes(normalizeImportText(readImportCell(worksheet.getRow(1), column))))
        if (!key) return
        if (seen.has(key)) throw new AppError(422, "errors.juice_import_duplicate_header", { sheet: worksheet.name, field: definitions[key] })
        seen.add(key)
    })
    return mapped
}

export async function bulkImportJuices(buffer: Buffer) {
    let workbook: ParsedWorkbook
    try { workbook = await loadWorkbookFromBuffer(buffer) }
    catch { throw new AppError(422, "errors.juice_import_workbook") }
    const materialSheet = sheet(workbook, names.materials)
    const formulaSheet = sheet(workbook, names.formulas)
    const physicalSheet = sheet(workbook, names.presentations)
    const materialColumns = headers(materialSheet, JUICE_MATERIAL_HEADERS)
    const physicalColumns = headers(physicalSheet, JUICE_PRESENTATION_HEADERS)
    if (formulaSheet.columnCount > MAX_JUICE_IMPORT_COLUMNS) throw new AppError(422, "errors.juice_import_columns", { max: MAX_JUICE_IMPORT_COLUMNS - 2 })
    const labels = ["Tipo", "Referencia", "Cliente", "SKU", "Nombre"]
    const actual = [[1, 1], [1, 2], [2, 1], [3, 1], [4, 1]].map(([row, column]) => normalizeImportText(readImportCell(formulaSheet.getRow(row), column)))
    if (actual.some((value, index) => value !== normalizeImportText(labels[index]))) throw new AppError(422, "errors.juice_import_matrix_layout")
    try {
        // All database reads and all writes share the same transaction. SHARE locks protect
        // active references/configuration until commit; a later write failure rolls back every sheet.
        return await sequelize.transaction(async transaction => {
            const query = { transaction, lock: transaction.LOCK.SHARE }
            const [rawRows, spiceRows, juiceRows, clients, physicalRows, global, overrides] = await Promise.all([
                Raw.findAll(query), SpiceMaterial.findAll(query), Juice.findAll(query), Client.findAll(query),
                Presentation.findAll(query), Global.findOne({ ...query, where: { singletonKey: "global" } }), Override.findAll(query),
            ])
            const issues: RowIssue[] = []
            function issue(worksheet: string, row: number, field: string, key: string, params: Record<string, unknown> = {}) {
                issues.push({ row, field: `${worksheet}!${field}`, key, params: { sheet: worksheet, ...params } })
            }
            function parse<T>(schema: z.ZodType<T>, value: unknown, worksheet: string, row: number, prefix = ""): T | undefined {
                const result = schema.safeParse(value)
                if (result.success) return result.data
                for (const error of result.error.issues) issue(worksheet, row, `${prefix}${error.path.join(".")}`, `errors.zod.${error.code}`, { defaultValue: error.message })
                return undefined
            }
            function resolve(value: string, pool: Ref[], worksheet: string, row: number, field: string): Ref | undefined {
                const codes = pool.filter(ref => codeKey(ref.code) === codeKey(value))
                const matches = codes.length ? codes : pool.filter(ref => normalizeImportText(ref.displayName) === normalizeImportText(value))
                if (!value || matches.length !== 1 || !matches[0].isActive) {
                    issue(worksheet, row, field, "errors.juice_import_reference", { value })
                    return undefined
                }
                return matches[0]
            }
            const raws: Ref[] = rawRows.map(row => ({ id: row.id, code: row.code, displayName: row.displayName, isActive: row.isActive }))
            const spiceCatalog: Ref[] = spiceRows.map(row => ({ id: row.id, code: row.code, displayName: row.displayName, isActive: row.isActive }))
            const juices: Ref[] = juiceRows.map(row => ({ id: row.id, code: row.code, displayName: row.displayName, isActive: row.isActive }))
            const materials: Material[] = []
            for (let rowNumber = 2; rowNumber <= materialSheet.rowCount; rowNumber++) {
                const row = materialSheet.getRow(rowNumber)
                if (isImportRowBlank(row, materialColumns)) continue
                const read = (field: keyof typeof JUICE_MATERIAL_HEADERS) => readImportCell(row, materialColumns.get(field))
                const kind = normalizeImportText(read("kind"))
                const common = { code: text(read("code")), displayName: text(read("displayName")) }
                const ref: Ref = { ...common, isActive: true }
                let candidate: Material | undefined
                if (kind === "materia prima" || kind === "raw") {
                    const input = parse(schemas.createJuiceRawMaterialSchema, { ...common, purchaseUnit: text(read("purchaseUnit")).toUpperCase(), yieldPoundsPerLiter: numeric(read("yieldPoundsPerLiter")), costPerUnit: numeric(read("costPerUnit")) }, names.materials, rowNumber)
                    if (input) {
                        const cost = toDecimal(input.yieldPoundsPerLiter).times(input.costPerUnit)
                        if (cost.greaterThan("9999999999.9999")) issue(names.materials, rowNumber, "costPerLiter", "errors.juice_cost_out_of_range")
                        candidate = { row: rowNumber, kind: "raw", input, ref }
                    }
                } else if (kind === "especia" || kind === "spice") {
                    if (text(read("purchaseUnit")).toUpperCase() !== "GRAMO" || text(read("yieldPoundsPerLiter"))) issue(names.materials, rowNumber, "purchaseUnit", "errors.juice_import_spice_unit")
                    const input = parse(schemas.createJuiceSpiceMaterialSchema, { ...common, costPerGram: numeric(read("costPerUnit")) }, names.materials, rowNumber)
                    if (input) candidate = { row: rowNumber, kind: "spice", input, ref }
                } else issue(names.materials, rowNumber, "kind", "errors.juice_import_material_type")
                if (!candidate) continue
                const pool = candidate.kind === "raw" ? raws : spiceCatalog
                if (pool.some(existing => codeKey(existing.code) === codeKey(ref.code))) issue(names.materials, rowNumber, "code", "errors.juice_duplicate")
                else { pool.push(ref); materials.push(candidate) }
            }
            const formulas: Formula[] = []
            for (let column = 3; column <= formulaSheet.columnCount; column++) {
                const letter = formulaSheet.getColumn(column).letter
                const cell = (row: number) => readImportCell(formulaSheet.getRow(row), column)
                if (Array.from({ length: Math.max(0, formulaSheet.rowCount - 1) }, (_, i) => cell(i + 2)).every(value => text(value) === "")) continue
                const clientName = text(cell(2))
                const matchingClients = clients.filter(row => row.isActive && normalizeImportText(row.name) === normalizeImportText(clientName))
                if (matchingClients.length !== 1 || !matchingClients[0].isActive) issue(names.formulas, 2, letter, "errors.juice_import_reference", { value: clientName })
                const identity = parse(schemas.createJuiceSchema.omit({ pricePerPound: true, image: true }), { code: text(cell(3)), displayName: text(cell(4)), clientId: matchingClients[0]?.id }, names.formulas, 3, `${letter}.`)
                if (!identity) continue
                const ref: Ref = { code: identity.code, displayName: identity.displayName, isActive: true }
                if (juices.some(existing => codeKey(existing.code) === codeKey(ref.code))) { issue(names.formulas, 3, letter, "errors.juice_duplicate"); continue }
                juices.push(ref)
                const formula: Formula = { column, ref, clientId: identity.clientId, liquids: [], spices: [] }
                const usedRaw = new Set<Ref>(), usedSpices = new Set<Ref>()
                for (let row = 5; row <= formulaSheet.rowCount; row++) {
                    const rawValue = cell(row)
                    if (!text(rawValue)) continue // Blank = absent component; numeric zero is validated below.
                    const value = numeric(rawValue)
                    const kind = normalizeImportText(readImportCell(formulaSheet.getRow(row), 1))
                    const reference = text(readImportCell(formulaSheet.getRow(row), 2))
                    const isRaw = kind === "materia prima" || kind === "raw"
                    const isSpice = kind === "especia" || kind === "spice"
                    if (!isRaw && !isSpice) { issue(names.formulas, row, letter, "errors.juice_import_material_type"); continue }
                    if (value === undefined || !Number.isFinite(value) || value < 0 || (isRaw && value > 1)) { issue(names.formulas, row, letter, "errors.juice_import_fraction"); continue }
                    if (value === 0) continue
                    const material = resolve(reference, isRaw ? raws : spiceCatalog, names.formulas, row, `${letter}.${reference}`)
                    if (!material) continue
                    const used = isRaw ? usedRaw : usedSpices
                    if (used.has(material)) { issue(names.formulas, row, letter, "errors.juice_import_duplicate_component", { value: reference }); continue }
                    used.add(material)
                    if (isRaw) {
                        const input = parse(schemas.createJuiceMixSchema, { juiceId: 1, rawMaterialId: 1, percentage: toDecimal(value).times(100).toNumber() }, names.formulas, row, `${letter}.`)
                        if (input) formula.liquids.push({ ref: material, percentage: input.percentage, row })
                    } else {
                        const input = parse(schemas.createJuiceSpiceSchema, { juiceId: 1, spiceMaterialId: 1, gramsPerLiter: value }, names.formulas, row, `${letter}.`)
                        if (input) formula.spices.push({ ref: material, grams: input.gramsPerLiter, row })
                    }
                }
                if (!formula.liquids.reduce((sum, row) => sum.plus(row.percentage), toDecimal(0)).equals(100)) issue(names.formulas, 3, letter, "errors.juice_mix_incomplete")
                formulas.push(formula)
            }
            const physicals: Physical[] = []
            const physicalKeys = new Set<string>()
            for (let rowNumber = 2; rowNumber <= physicalSheet.rowCount; rowNumber++) {
                const row = physicalSheet.getRow(rowNumber)
                if (isImportRowBlank(row, physicalColumns)) continue
                const read = (field: keyof typeof JUICE_PRESENTATION_HEADERS) => readImportCell(row, physicalColumns.get(field))
                const ref = resolve(text(read("juice")), juices, names.presentations, rowNumber, "juice")
                const values = Object.fromEntries(Object.keys(JUICE_PRESENTATION_HEADERS).filter(key => key !== "juice" && key !== "displayLabel" && key !== "pricePerPound").map(key => [key, numeric(read(key as keyof typeof JUICE_PRESENTATION_HEADERS))]))
                const input = parse(schemas.createJuicePresentationSchema.omit({ juiceId: true }), { ...values, displayLabel: text(read("displayLabel")) }, names.presentations, rowNumber)
                const price = parse(schemas.createJuiceSchema.pick({ pricePerPound: true }), { pricePerPound: numeric(read("pricePerPound")) }, names.presentations, rowNumber)
                if (!ref || !input || !price) continue
                const physicalKey = `${codeKey(ref.code)}\u0000${input.displayLabel}`
                if (physicalKeys.has(physicalKey) || physicalRows.some(existing => existing.juiceId === ref.id && existing.displayLabel === input.displayLabel)) issue(names.presentations, rowNumber, "displayLabel", "errors.juice_duplicate")
                physicalKeys.add(physicalKey)
                const formula = formulas.find(candidate => candidate.ref === ref)
                const existingJuice = juiceRows.find(candidate => candidate.id === ref.id)
                const previousPrice = formula?.price ?? existingJuice?.pricePerPound
                if (previousPrice !== undefined && !toDecimal(previousPrice).equals(price.pricePerPound)) issue(names.presentations, rowNumber, "pricePerPound", "errors.juice_import_price_mismatch")
                if (formula) formula.price = price.pricePerPound
                // One global singleton plus active overrides by external client. Imports never create or edit
                // config.
                if (!global) issue(names.presentations, rowNumber, "constants", "errors.juice_config_required")
                const clientId = formula?.clientId ?? existingJuice?.clientId
                if (!clients.some(client => client.id === clientId && client.isActive)) issue(names.presentations, rowNumber, "client", "errors.juice_import_reference", { value: String(clientId) })
                physicals.push({ row: rowNumber, ref, input, price: price.pricePerPound })
            }
            for (const formula of formulas) if (formula.price === undefined) issue(names.formulas, 3, formulaSheet.getColumn(formula.column).letter, "errors.juice_import_presentation_required")
            if (issues.length) throw new BulkImportError(issues)
            if (!materials.length && !formulas.length && !physicals.length) throw new AppError(422, "errors.bulk_import_empty_file")
            const counts = { rawMaterials: 0, spiceMaterials: 0, juices: 0, mixRows: 0, spiceRows: 0, presentations: 0 }
            for (const material of materials) {
                if (material.kind === "raw") {
                    const costPerLiter = toDecimal(material.input.yieldPoundsPerLiter).times(material.input.costPerUnit).toDecimalPlaces(12).toNumber()
                    material.ref.id = (await Raw.create({ ...material.input, costPerLiter }, { transaction })).id
                    counts.rawMaterials++
                } else {
                    material.ref.id = (await SpiceMaterial.create(material.input, { transaction })).id
                    counts.spiceMaterials++
                }
            }
            const slugs = new Set(juiceRows.map(row => row.urlSlug))
            for (const formula of formulas) {
                const urlSlug = await generateUniqueSlug(formula.ref.displayName.slice(0, 100), async value => slugs.has(value))
                slugs.add(urlSlug)
                const input = schemas.createJuiceSchema.parse({ code: formula.ref.code, displayName: formula.ref.displayName, clientId: formula.clientId, pricePerPound: formula.price })
                formula.ref.id = (await Juice.create({ ...input, urlSlug, imageUrl: null }, { transaction })).id
                counts.juices++
                for (const liquid of formula.liquids) { await Mix.create({ juiceId: formula.ref.id, rawMaterialId: liquid.ref.id, percentage: liquid.percentage }, { transaction }); counts.mixRows++ }
                for (const spice of formula.spices) { await Spice.create({ juiceId: formula.ref.id, spiceMaterialId: spice.ref.id, gramsPerLiter: spice.grams }, { transaction }); counts.spiceRows++ }
            }
            for (const physical of physicals) {
                await Presentation.create({ ...physical.input, juiceId: physical.ref.id }, { transaction })
                counts.presentations++
            }
            const affectedClients = new Set([...formulas.map(formula => formula.clientId), ...physicals.map(physical => juiceRows.find(row => row.id === physical.ref.id)?.clientId)].filter(id => id !== undefined))
            return { ...counts, globalRevision: global?.revision ?? null,
                clientOverrideIds: overrides.filter(row => row.isActive && affectedClients.has(row.clientId)).map(row => row.id) }
        })
    } catch (error) {
        if (error instanceof UniqueConstraintError) throw new AppError(409, "errors.juice_duplicate")
        throw error
    }
}

export async function buildJuiceImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const materials = workbook.addWorksheet(names.materials)
    materials.columns = Object.values(JUICE_MATERIAL_HEADERS).map(header => ({ header, width: 24 }))
    const formulas = workbook.addWorksheet(names.formulas)
    formulas.addRows([["Tipo", "Referencia", "Jugo 1"], ["Cliente", "", ""], ["SKU", "", ""], ["Nombre", "", ""]])
    formulas.getColumn(1).width = 24; formulas.getColumn(2).width = 30; formulas.getColumn(3).width = 30
    const presentations = workbook.addWorksheet(names.presentations)
    presentations.columns = Object.values(JUICE_PRESENTATION_HEADERS).map(header => ({ header, width: 24 }))
    const help = workbook.addWorksheet("Instrucciones")
    help.getColumn(1).width = 150
    for (const line of [
        "Importación de jugos fijos, create-only: las tres hojas se validan y guardan juntas; un error revierte todo el archivo. No cambia registros existentes ni sus precios.",
        "Plantilla normalizada: traslada los valores del libro original; no importa su formato libre ni interpreta fórmulas. Excel debe traer números o resultados de fórmulas ya calculados.",
        "COSTO MP: Tipo = MATERIA PRIMA o ESPECIA. Código único por catálogo (incluye inactivos), Nombre, Unidad LIBRA/LITRO/GRAMO, Libras por litro positivas y Costo unitario no negativo. Costo/litro se calcula en el servidor; cero es válido.",
        "ESPECIA: Unidad GRAMO, Libras por litro vacías y Costo unitario = USD/gramo; se crea en el catálogo propio de especias, no en materias primas.",
        "% MP: A1 Tipo, B1 Referencia. Una columna por jugo desde C; fila 2 Cliente, fila 3 SKU, fila 4 Nombre. Cliente debe existir activo y su nombre resolver sin ambigüedad.",
        "Desde fila 5: A = MATERIA PRIMA o ESPECIA, B = código o nombre del material. En cada columna de jugo: fracción 0..1 para materia prima (0.15 = 15%; Excel 15% equivale a 0.15) o gramos/litro para especia. Vacío/cero omite el componente. Las fracciones activas deben sumar exactamente 1; no usar 15 para 15%.",
        "Referencias: códigos exactos sin distinguir mayúsculas primero; si no existe el código, nombre sin distinguir acentos/mayúsculas. Coincidencia inexistente, ambigua o inactiva es error. Materiales nuevos en COSTO MP están disponibles en el mismo archivo.",
        "COSTO POR PRESENTACIÓN: una fila por jugo/presentación; Jugo = SKU o nombre. Todos los costos/cantidades son obligatorios, incluso cero para sticker 2. Cada jugo nuevo necesita al menos una presentación.",
        "PRICE LB es el precio por libra del jugo: debe ser idéntico en todas sus presentaciones. Margen por caja es el target de esa presentación. Un jugo existente conserva su PRICE LB; solo se pueden agregar presentaciones nuevas con el mismo precio.",
        "Constantes: configurar primero /admin/juice-config. Se usan las globales vigentes y los overrides activos del Cliente; null hereda y cero sobreescribe. Este archivo no carga, cambia ni selecciona otros conjuntos de constantes.",
        "No cargar lbs/caja, cajas/lbs por contenedor ni costos logísticos por libra: J2 los deriva de las dimensiones y constantes. Conserva hasta 12 decimales en costos fuente y PRICE LB; gramos/porcentajes/cantidades hasta 6, ml hasta 3 y margen hasta 4.",
        "Las tres hojas son obligatorias; se admiten hojas de catálogos/presentaciones sin datos si no se necesitan. Máximo 1000 filas por hoja y 100 columnas de jugos. Imagen del jugo se agrega después mediante edición.",
    ]) help.addRow([line])
    for (const worksheet of [materials, formulas, presentations]) {
        worksheet.getRow(1).font = { bold: true }
        worksheet.views = [{ state: "frozen", ySplit: worksheet === formulas ? 4 : 1 }]
    }
    return writeWorkbookToBuffer(workbook)
}
