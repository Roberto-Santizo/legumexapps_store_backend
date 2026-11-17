import type ExcelJS from "exceljs"
import { normalizeImportText } from "../../../shared/utils/excelImport.util"
import { businessDayKey } from "../../../shared/utils/businessTime.util"
import type { RowIssue } from "../../../shared/errors/AppError"
import { LABOR_IMPORT_COLUMNS, LABOR_IMPORT_MAX_ROWS, LABOR_IMPORT_SHEET } from "../constants/laborImport.constant"
import type { LaborImportLine, LaborImportSettings } from "../constants/laborImport.constant"
import { saveLaborTemplateSchema } from "../schemas/laborTemplate.schema"
import type { SaveLaborTemplateInput } from "../schemas/laborTemplate.schema"
import { resolveLaborCalendar } from "./laborTemplateCalendar"
import { calculateLaborTemplate } from "./laborTemplateCalculation"
import { getLaborReference } from "./laborTemplateReference"

type ImportRow = { row: number; cells: ExcelJS.Cell[] }
type AddIssue = (row: number, field: string, key: string, params?: Record<string, unknown>) => void
const text = (row: ImportRow, column: number) => row.cells[column].text.trim()
const hasAmount = (row: ImportRow) => text(row, 3) !== "" || text(row, 4) !== ""
const hasFormula = (cell: ExcelJS.Cell) => cell.value && typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value)

function amount(row: ImportRow, column: number) {
    const value = row.cells[column].value
    if (typeof value === "number") return value
    const valueText = text(row, column)
    return /^\d+(\.\d+)?$/.test(valueText) ? Number(valueText) : Number.NaN
}

function readRows(workbook: ExcelJS.Workbook, issue: AddIssue): ImportRow[] {
    const sheet = workbook.getWorksheet(LABOR_IMPORT_SHEET)
    if (!sheet) { issue(1, LABOR_IMPORT_SHEET, "sheet"); return [] }
    if (sheet.rowCount > LABOR_IMPORT_MAX_ROWS + 1) { issue(1, LABOR_IMPORT_SHEET, "limit", { max: LABOR_IMPORT_MAX_ROWS }); return [] }
    const columns = new Map<string, number>()
    sheet.getRow(1).eachCell((cell, index) => {
        const header = normalizeImportText(cell.text)
        if (columns.has(header)) issue(1, cell.text, "duplicate")
        if (!LABOR_IMPORT_COLUMNS.some(label => normalizeImportText(label) === header)) issue(1, cell.text, "column")
        if (hasFormula(cell)) issue(1, cell.address, "formula")
        columns.set(header, index)
    })
    const missing = LABOR_IMPORT_COLUMNS.filter(label => !columns.has(normalizeImportText(label)))
    for (const label of missing) issue(1, label, "column")
    if (missing.length) return []
    const rows: ImportRow[] = []
    for (let index = 2; index <= sheet.rowCount; index++) {
        const row = sheet.getRow(index)
        const cells = LABOR_IMPORT_COLUMNS.map(label => row.getCell(columns.get(normalizeImportText(label))!))
        if (cells.every(cell => !cell.text.trim() && !cell.value)) continue
        row.eachCell(cell => {
            if (hasFormula(cell)) issue(index, cell.address, "formula")
        })
        rows.push({ row: index, cells })
    }
    return rows
}

export function planLaborWorkbook(workbook: ExcelJS.Workbook, lines: LaborImportLine[], existingCodes: string[], now = new Date(), settings: LaborImportSettings = getLaborReference().settings) {
    const issues: RowIssue[] = []
    const issue: AddIssue = (row, field, key, params) => {
        if (!issues.some(entry => entry.row === row && entry.field === field && entry.key === `errors.labor_import_${key}`)) issues.push({ sheet: LABOR_IMPORT_SHEET, row, field, key: `errors.labor_import_${key}`, params: { field, ...params } })
    }
    const rows = readRows(workbook, issue)
    const catalog = new Map<string, { line: LaborImportLine; jobTitle: string }>()
    const ambiguous = new Set<string>()
    for (const line of lines.filter(line => line.isActive)) for (const position of line.positions) {
        if (catalog.has(position.code)) ambiguous.add(position.code)
        catalog.set(position.code, { line, jobTitle: position.jobTitle })
    }
    const byLine = new Map<string, { line: LaborImportLine; rows: ImportRow[] }>()
    const seen = new Set<string>()
    for (const row of rows) {
        const positionCode = text(row, 0).toUpperCase()
        const source = catalog.get(positionCode)
        if (!source || ambiguous.has(positionCode)) { issue(row.row, LABOR_IMPORT_COLUMNS[0], "reference"); continue }
        if (seen.has(positionCode)) issue(row.row, LABOR_IMPORT_COLUMNS[0], "duplicate")
        seen.add(positionCode)
        if (text(row, 1) !== source.line.displayName || text(row, 2) !== source.jobTitle) issue(row.row, "PLANTILLA / PUESTO", "reference")
        const group = byLine.get(source.line.code) ?? { line: source.line, rows: [] }
        group.rows.push(row)
        byLine.set(source.line.code, group)
    }
    const existing = new Set(existingCodes.map(value => value.toUpperCase()))
    const calendar = resolveLaborCalendar("current_year", now)
    const plans: { row: number; input: SaveLaborTemplateInput; calculation: ReturnType<typeof calculateLaborTemplate> }[] = []
    let selected = 0
    for (const { line, rows: positions } of byLine.values()) {
        if (!positions.some(hasAmount)) continue
        selected++
        const before = issues.length
        const hasReferenceErrors = positions.some(row => issues.some(entry => entry.row === row.row))
        const firstRow = positions[0].row
        const templateCode = `MOD-${line.code}`
        if (existing.has(templateCode)) issue(positions[0].row, "PLANTILLA", "exists")
        const present = new Set(positions.map(row => text(row, 0).toUpperCase()))
        for (const position of line.positions) if (!present.has(position.code)) issue(positions[0].row, position.code, "missingPosition")
        for (const row of positions) for (const column of [3, 4]) if (/%/.test(row.cells[column].numFmt)) issue(row.row, LABOR_IMPORT_COLUMNS[column], "amount")
        const parsed = saveLaborTemplateSchema.safeParse({
            code: templateCode, lineCode: line.code, displayName: line.displayName, isActive: true,
            weeklyHours: settings.weeklyHours, benefits: structuredClone(settings.benefits),
            effectiveFrom: businessDayKey(now), changeReason: "Carga de salario mensual y bono decreto desde Excel de RR. HH.",
            calendarMode: "current_year", daysPerYear: calendar.daysPerYear, expectedVersion: 0,
            positions: positions.map(row => ({
                code: text(row, 0).toUpperCase(), jobTitle: text(row, 2), isActive: true,
                salaryMonthlyGtq: amount(row, 3), bonusMonthlyGtq: amount(row, 4),
                applicableBenefitCodes: settings.benefits.map(benefit => benefit.code),
            })),
        })
        if (!parsed.success) for (const error of parsed.error.issues) {
            const [section, index, field] = error.path
            if (section === "positions" && typeof index === "number" && positions[index]) {
                const column = field === "salaryMonthlyGtq" ? 3 : field === "bonusMonthlyGtq" ? 4 : 0
                issue(positions[index].row, LABOR_IMPORT_COLUMNS[column], column >= 3 ? "amount" : "value")
            } else issue(positions[0].row, "PLANTILLA", "configuration")
        }
        else if (issues.length === before && !hasReferenceErrors) {
            const { calendarMode, daysPerYear, weeklyHours, positions: calculatedPositions, benefits } = parsed.data
            plans.push({ row: firstRow, input: parsed.data, calculation: calculateLaborTemplate({ calendarMode, daysPerYear, weeklyHours, positions: calculatedPositions, benefits }, calendar.calendarYear) })
        }
    }
    if (!selected) issue(2, "Salario Mensual / Bono Decreto", "selection")
    return { plans, issues, summary: { selected, templates: plans.length, positions: plans.reduce((count, plan) => count + plan.input.positions.length, 0), includedPositions: plans.reduce((count, plan) => count + plan.calculation.includedPositions, 0), errors: issues.length } }
}
