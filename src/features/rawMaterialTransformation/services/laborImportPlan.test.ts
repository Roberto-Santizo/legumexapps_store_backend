import type ExcelJS from "exceljs"
import { buildLaborImportTemplate } from "./laborImportTemplate"
import { planLaborWorkbook } from "./laborImportPlan"
import { getLaborReference } from "./laborTemplateReference"
import { loadWorkbookFromBuffer } from "../../../shared/utils/excelImport.util"
import { LABOR_IMPORT_COLUMNS } from "../constants/laborImport.constant"

const reference = getLaborReference()
const lines = reference.lines.slice(0, 2).map(line => ({ ...line, positions: line.positions.slice(0, 2) }))
const now = new Date("2026-11-16T12:00:00Z")

async function completedWorkbook(selected = [0], salary = 1000, bonus = 100) {
    const workbook = await loadWorkbookFromBuffer(await buildLaborImportTemplate(lines))
    const names = new Set(selected.map(index => lines[index].displayName))
    workbook.getWorksheet("Sueldos")!.eachRow((row, index) => {
        if (index > 1 && names.has(row.getCell(2).text)) {
            row.getCell(4).value = salary
            row.getCell(5).value = bonus
        }
    })
    return workbook
}

test("HR only receives five columns and two editable amounts for the real 713 positions", async () => {
    const workbook = await loadWorkbookFromBuffer(await buildLaborImportTemplate(reference.lines))
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Sueldos"])
    const sheet = workbook.getWorksheet("Sueldos")!
    expect(sheet.rowCount).toBe(714)
    expect(sheet.columnCount).toBe(5)
    expect(sheet.getRow(1).values).toEqual([undefined, ...LABOR_IMPORT_COLUMNS])
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
    expect(sheet.autoFilter).toBeDefined()
    expect((sheet as ExcelJS.Worksheet & { sheetProtection: { sheet: boolean } }).sheetProtection.sheet).toBe(true)
    sheet.eachRow((row, index) => {
        if (index === 1) return
        for (const column of [4, 5]) {
            expect(row.getCell(column).value).toBeNull()
            expect(row.getCell(column).protection.locked).toBe(false)
        }
        for (const column of [1, 2, 3]) expect(row.getCell(column).protection?.locked ?? true).toBe(true)
    })
    expect(sheet.getColumn(1).values.slice(2).map(String).sort()).toEqual(reference.lines.flatMap(line => line.positions.map(position => position.code)).sort())
})

test("salary and bonus alone generate full template inputs and automatic benefits while blank lines wait", async () => {
    const result = planLaborWorkbook(await completedWorkbook(), lines, [], now)
    expect(result.issues).toEqual([])
    expect(result.summary).toEqual({ selected: 1, templates: 1, positions: 2, includedPositions: 2, errors: 0 })
    expect(result.plans[0].input).toMatchObject({ expectedVersion: 0, calendarMode: "current_year", daysPerYear: 365, weeklyHours: reference.settings.weeklyHours, effectiveFrom: "2026-11-16", benefits: reference.settings.benefits })
    expect(result.plans[0].calculation.total.monthlyGtq).toBeCloseTo(3064.511111111111, 8)
    expect(result.plans[0].input.positions.every(position => position.isActive && position.applicableBenefitCodes.length === 5)).toBe(true)
})

test("the example salary keeps the precise configured benefit rate instead of multiplying by a rounded 43.23%", async () => {
    const result = planLaborWorkbook(await completedWorkbook([0], 2921.9, 250), lines, [], now)
    expect(result.issues).toEqual([])
    expect(result.plans[0].calculation.positions[0].benefitsMonthlyGtq).toBeCloseTo(1263.007507777778, 6)
    expect(result.plans[0].calculation.positions[0].benefitsMonthlyGtq.toFixed(2)).toBe("1263.01")
})

test.each([4, 5])("a missing amount in column %i cannot silently become zero", async column => {
    const workbook = await completedWorkbook()
    workbook.getWorksheet("Sueldos")!.getRow(2).getCell(column).value = null
    const result = planLaborWorkbook(workbook, lines, [], now)
    expect(result.plans).toHaveLength(0)
    expect(result.issues.some(issue => issue.sheet === "Sueldos" && issue.row === 2 && issue.key === "errors.labor_import_amount")).toBe(true)
})

test("one populated position requires the rest of its line, but does not select an untouched line", async () => {
    const workbook = await completedWorkbook()
    workbook.getWorksheet("Sueldos")!.getRow(3).getCell(4).value = null
    workbook.getWorksheet("Sueldos")!.getRow(3).getCell(5).value = null
    const result = planLaborWorkbook(workbook, lines, [], now)
    expect(result.summary.selected).toBe(1)
    expect(result.plans).toHaveLength(0)
    expect(result.issues.some(issue => issue.row === 3 && issue.key === "errors.labor_import_amount")).toBe(true)
})

test("explicit zero amounts select a line and remain valid inputs instead of being mistaken for blanks", async () => {
    const result = planLaborWorkbook(await completedWorkbook([0], 0, 0), lines, [], now)
    expect(result.issues).toEqual([])
    expect(result.summary.selected).toBe(1)
    expect(result.plans[0].calculation.total.monthlyGtq).toBe(0)
    expect(result.summary.includedPositions).toBe(2)
})

test.each(["missing", "duplicate", "other-line", "job", "template", "unknown"])("rejects %s identities instead of assigning a salary to a different position", async change => {
    const workbook = await completedWorkbook()
    const sheet = workbook.getWorksheet("Sueldos")!
    const row = sheet.getRow(2)
    if (change === "missing") sheet.spliceRows(2, 1)
    if (change === "duplicate") row.getCell(1).value = sheet.getRow(3).getCell(1).value
    if (change === "other-line") row.getCell(1).value = lines[1].positions[0].code
    if (change === "job") row.getCell(3).value = "Puesto equivocado"
    if (change === "template") row.getCell(2).value = "Otra plantilla"
    if (change === "unknown") row.getCell(1).value = "UNKNOWN"
    expect(planLaborWorkbook(workbook, lines, [], now).issues.length).toBeGreaterThan(0)
})

test.each([-1, 1000001, 100.001, "Q100.00", "texto"])("rejects invalid monetary input %s", async value => {
    const workbook = await completedWorkbook()
    workbook.getWorksheet("Sueldos")!.getRow(2).getCell(4).value = value
    expect(planLaborWorkbook(workbook, lines, [], now).issues.map(issue => issue.key)).toContain("errors.labor_import_amount")
})

test("cached formulas, duplicate imports and percentage-formatted amounts block the batch", async () => {
    const workbook = await completedWorkbook()
    const sheet = workbook.getWorksheet("Sueldos")!
    sheet.getRow(2).getCell(4).value = { formula: "500+500", result: 1000 }
    sheet.getRow(2).getCell(5).numFmt = "0.00%"
    const result = planLaborWorkbook(workbook, lines, [`MOD-${lines[0].code}`], now)
    expect(result.issues.map(issue => issue.key)).toEqual(expect.arrayContaining(["errors.labor_import_formula", "errors.labor_import_exists", "errors.labor_import_amount"]))
})

test("leap years, effective date and parameters are resolved by the system without HR filling extra fields", async () => {
    const workbook = await completedWorkbook()
    const settings = { weeklyHours: 40, benefits: [{ code: "CUSTOM", displayName: "Configured benefit", percentage: 10, basis: "salary_plus_bonus" as const, isActive: true }] }
    const result = planLaborWorkbook(workbook, lines, [], new Date("2028-07-01T12:00:00Z"), settings)
    expect(result.issues).toEqual([])
    expect(result.plans[0].input.effectiveFrom).toBe("2028-07-01")
    expect(result.plans[0].calculation).toMatchObject({ calendarYear: 2028, daysPerYear: 366 })
    expect(result.plans[0].calculation.total.monthlyGtq).toBe(2420)
    expect(result.plans[0].input.weeklyHours).toBe(40)
})

test("an untouched workbook creates nothing; missing and old-format sheets require downloading the new format", async () => {
    const workbook = await loadWorkbookFromBuffer(await buildLaborImportTemplate(lines))
    expect(planLaborWorkbook(workbook, lines, [], now).issues.map(issue => issue.key)).toContain("errors.labor_import_selection")
    workbook.getWorksheet("Sueldos")!.getCell("A1").value = "Old position header"
    expect(planLaborWorkbook(workbook, lines, [], now).issues.map(issue => issue.key)).toContain("errors.labor_import_column")
    workbook.removeWorksheet("Sueldos")
    expect(planLaborWorkbook(workbook, lines, [], now).issues.map(issue => issue.key)).toContain("errors.labor_import_sheet")
})
