jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn(), query: jest.fn() } }))
jest.mock("../models/LaborTemplate.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("./laborTemplate.service", () => ({ laborTemplateService: { listLines: jest.fn(), createInTransaction: jest.fn() } }))

import sequelize from "../../../database/connection"
import LaborTemplate from "../models/LaborTemplate.model"
import { laborTemplateService } from "./laborTemplate.service"
import { laborImportService } from "./laborImport.service"
import { buildLaborImportTemplate } from "./laborImportTemplate"
import { getLaborReference } from "./laborTemplateReference"
import * as laborReference from "./laborTemplateReference"
import { loadWorkbookFromBuffer } from "../../../shared/utils/excelImport.util"

const mock = (value: unknown) => value as jest.Mock
const transaction = { LOCK: { UPDATE: "UPDATE" } }
const source = getLaborReference().lines.slice(0, 2).map(line => ({ ...line, positions: line.positions.slice(0, 1) }))
let lines: typeof source
let existing: { code: string }[]

async function file() {
    const workbook = await loadWorkbookFromBuffer(await buildLaborImportTemplate(lines))
    workbook.getWorksheet("Sueldos")!.eachRow((row, index) => {
        if (index === 1) return
        row.getCell(4).value = 1000; row.getCell(5).value = 100
    })
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

beforeEach(() => {
    jest.resetAllMocks()
    lines = structuredClone(source)
    existing = []
    mock(sequelize.transaction).mockImplementation(async operation => operation(transaction))
    mock(laborTemplateService.listLines).mockImplementation(async () => structuredClone(lines))
    mock(LaborTemplate.findAll).mockImplementation(async () => structuredClone(existing))
})

afterEach(() => jest.restoreAllMocks())

test("preview reads data and costs without opening a write transaction or persisting salaries", async () => {
    const result = await laborImportService.plan(await file())
    expect(result.issues).toEqual([])
    expect(result.summary.templates).toBe(2)
    expect(result.plans[0].calculation.total.monthlyGtq).toBeCloseTo(1532.255555555556, 8)
    expect(sequelize.transaction).not.toHaveBeenCalled()
    expect(laborTemplateService.createInTransaction).not.toHaveBeenCalled()
})

test("confirmation uses one transaction and the labor lock for every template, with the session author", async () => {
    const buffer = await file()
    const result = await laborImportService.plan(buffer)
    await expect(laborImportService.confirm(buffer, result.previewHash, 42)).resolves.toEqual({ created: 2, positions: 2 })
    expect(sequelize.transaction).toHaveBeenCalledTimes(1)
    expect(sequelize.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(174226, 3)", { transaction })
    expect(laborTemplateService.listLines).toHaveBeenLastCalledWith(transaction)
    expect(laborTemplateService.createInTransaction).toHaveBeenCalledTimes(2)
    for (const call of mock(laborTemplateService.createInTransaction).mock.calls) {
        expect(call[0]).toMatchObject({ expectedVersion: 0, isActive: true, calendarMode: "current_year" })
        expect(call[1]).toBe(42)
        expect(call[2]).toBe(transaction)
        expect(call[3]).toBeInstanceOf(Date)
    }
})

test.each(["file", "catalog", "existing", "calendar", "day", "configuration"])("a changed %s invalidates the reviewed preview before any write", async change => {
    const buffer = await file()
    const previewDate = change === "calendar" ? new Date("2010-01-01T12:00:00Z") : change === "day" ? new Date(Date.now() - 86400000) : new Date()
    const result = await laborImportService.plan(buffer, undefined, previewDate)
    let submitted = buffer
    if (change === "catalog") lines[0].revision++
    if (change === "existing") existing.push({ code: "OTHER-NEW-TEMPLATE" })
    if (change === "configuration") {
        const current = getLaborReference()
        jest.spyOn(laborReference, "getLaborReference").mockReturnValue({ ...current, settings: { ...current.settings, weeklyHours: 40 } })
    }
    if (change === "file") {
        const workbook = await loadWorkbookFromBuffer(buffer)
        workbook.getWorksheet("Sueldos")!.getRow(2).getCell(4).value = 999
        submitted = Buffer.from(await workbook.xlsx.writeBuffer())
    }
    await expect(laborImportService.confirm(submitted, result.previewHash, 42)).rejects.toMatchObject({ statusCode: 409, key: "errors.labor_import_changed" })
    expect(laborTemplateService.createInTransaction).not.toHaveBeenCalled()
})

test("all rows are validated before the first template is persisted", async () => {
    const workbook = await loadWorkbookFromBuffer(await file())
    workbook.getWorksheet("Sueldos")!.getRow(3).getCell(4).value = null
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const preview = await laborImportService.plan(buffer)
    expect(preview.issues.length).toBeGreaterThan(0)
    await expect(laborImportService.confirm(buffer, preview.previewHash, 42)).rejects.toMatchObject({ name: "BulkImportError" })
    expect(laborTemplateService.createInTransaction).not.toHaveBeenCalled()
})

test("a persistence failure escapes the single transaction so Sequelize can roll back the batch", async () => {
    const buffer = await file()
    const preview = await laborImportService.plan(buffer)
    const failure = new Error("Synthetic write failure")
    mock(laborTemplateService.createInTransaction).mockResolvedValueOnce(1).mockRejectedValueOnce(failure)
    await expect(laborImportService.confirm(buffer, preview.previewHash, 42)).rejects.toBe(failure)
    expect(sequelize.transaction).toHaveBeenCalledTimes(1)
})

test("replaying the same import cannot overwrite templates or create another initial revision", async () => {
    const buffer = await file()
    const preview = await laborImportService.plan(buffer)
    mock(laborTemplateService.createInTransaction).mockImplementation(async input => { existing.push({ code: input.code }); return existing.length })
    await laborImportService.confirm(buffer, preview.previewHash, 42)
    await expect(laborImportService.confirm(buffer, preview.previewHash, 42)).rejects.toMatchObject({ statusCode: 409 })
    expect(laborTemplateService.createInTransaction).toHaveBeenCalledTimes(2)
})
