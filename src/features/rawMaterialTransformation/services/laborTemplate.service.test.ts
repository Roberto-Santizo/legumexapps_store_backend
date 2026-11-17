jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn(), query: jest.fn() } }))
jest.mock("../models/LaborTemplate.model", () => ({ __esModule: true, default: { findByPk: jest.fn(), findOne: jest.fn(), create: jest.fn(), findAndCountAll: jest.fn(), findAll: jest.fn() } }))
jest.mock("../models/LaborTemplateLine.model", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn(), findAll: jest.fn() } }))
jest.mock("../models/LaborTemplatePosition.model", () => ({ __esModule: true, default: { destroy: jest.fn(), bulkCreate: jest.fn() } }))
jest.mock("../models/LaborTemplateRevision.model", () => ({ __esModule: true, default: { create: jest.fn(), findOne: jest.fn(), findAll: jest.fn() } }))

import sequelize from "../../../database/connection"
import LaborTemplate from "../models/LaborTemplate.model"
import LaborTemplateLine from "../models/LaborTemplateLine.model"
import LaborTemplatePosition from "../models/LaborTemplatePosition.model"
import LaborTemplateRevision from "../models/LaborTemplateRevision.model"
import { laborTemplateService as service } from "./laborTemplate.service"
import { getLaborReference } from "./laborTemplateReference"
import type { SaveLaborTemplateInput } from "../schemas/laborTemplate.schema"

const mock = (fn: unknown) => fn as jest.Mock
const transaction = { LOCK: { UPDATE: "UPDATE" } }
const reference = getLaborReference()
const input = (): SaveLaborTemplateInput => ({ ...reference.settings, ...reference.example, positions: structuredClone(reference.example.positions),
    isActive: true, effectiveFrom: "2024-01-01", changeReason: "Excel reference", expectedVersion: 0 })
// Only request fields, as the HTTP strict schema requires.
const body = (): SaveLaborTemplateInput => {
    const { code, displayName, lineCode, positions, isActive, effectiveFrom, changeReason, expectedVersion, daysPerYear, weeklyHours, benefits, calendarMode } = input()
    return { code, displayName, lineCode, positions, isActive, effectiveFrom, changeReason, expectedVersion, daysPerYear, weeklyHours, benefits, calendarMode }
}
let current: Record<string, unknown> | null
let snapshots: Map<number, Record<string, unknown>>

beforeEach(() => {
    jest.resetAllMocks()
    current = null
    snapshots = new Map()
    mock(sequelize.transaction).mockImplementation((operation: (value: unknown) => unknown) => operation(transaction))
    mock(LaborTemplate.findByPk).mockImplementation(() => current)
    mock(LaborTemplate.findOne).mockResolvedValue(null)
    mock(LaborTemplate.create).mockImplementation(async fields => {
        current = { ...fields, id: 7, update: jest.fn(async patch => { Object.assign(current!, patch); return current }) }
        return current
    })
    mock(LaborTemplateLine.findOne).mockResolvedValue(null)
    mock(LaborTemplateLine.create).mockImplementation(async fields => ({ ...fields, id: 3 }))
    mock(LaborTemplateLine.findAll).mockResolvedValue([])
    mock(LaborTemplateRevision.create).mockImplementation(async fields => {
        snapshots.set(fields.revision, { ...structuredClone(fields), createdAt: new Date("2024-01-01T00:00:00Z") })
    })
    mock(LaborTemplateRevision.findOne).mockImplementation(async options => snapshots.get(options.where.revision))
})

test("creates a template, positions and the immutable calculation snapshot in one transaction", async () => {
    const result = await service.save(undefined, body(), 42)
    expect(result.id).toBe(7)
    expect(result.expectedVersion).toBe(1)
    expect(result.calculation.total.hourlyGtq.toFixed(4)).toBe("994.7147")
    expect(sequelize.transaction).toHaveBeenCalledTimes(1)
    expect(sequelize.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(174226, 3)", { transaction })
    expect(LaborTemplateLine.create).toHaveBeenCalledWith(expect.objectContaining({ code: "1LNDTA", positions: expect.arrayContaining([{ code: "1LNDTA001", jobTitle: "SUPERVISOR DE AREA" }]) }), { transaction })
    expect(result.line.positions).toHaveLength(32)
    expect(result.positions).toHaveLength(43)
    expect(LaborTemplatePosition.bulkCreate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ templateId: 7, sortOrder: 0, salaryMonthlyGtq: 2921.9 })]), { transaction })
    expect(LaborTemplateRevision.create).toHaveBeenCalledWith(expect.objectContaining({ createdByUserId: 42, revision: 1, snapshot: expect.objectContaining({ calculation: result.calculation }) }), { transaction })
    expect(LaborTemplatePosition.destroy).not.toHaveBeenCalled()
})

test("editing changes the current calculation while the previous version remains readable", async () => {
    const original = await service.save(undefined, body(), 42)
    const changed = body()
    changed.expectedVersion = 1
    changed.positions[0].salaryMonthlyGtq = 4000
    changed.changeReason = "Salary increase"
    const next = await service.save(7, changed, 43)
    expect(next.revision).toBe(2)
    expect(next.calculation.total.hourlyGtq).toBeGreaterThan(original.calculation.total.hourlyGtq)
    const historical = await service.get(7, 1)
    expect(historical.positions[0].salaryMonthlyGtq).toBe(2921.9)
    expect(historical.calculation).toEqual(original.calculation)
    expect(historical.createdByUserId).toBe(42)
    expect(LaborTemplatePosition.destroy).toHaveBeenCalledWith({ where: { templateId: 7 }, transaction })
})

test("a stale editor cannot overwrite a newer version", async () => {
    await service.save(undefined, body(), 1)
    mock(LaborTemplatePosition.destroy).mockClear()
    await expect(service.save(7, body(), 2)).rejects.toMatchObject({ statusCode: 409, key: "errors.labor_template_version_conflict" })
    expect(LaborTemplatePosition.destroy).not.toHaveBeenCalled()
    expect(snapshots.size).toBe(1)
})

test("duplicate code is rejected before creating a line or writing positions", async () => {
    mock(LaborTemplate.findOne).mockResolvedValue({ id: 99 })
    await expect(service.save(undefined, body(), 1)).rejects.toMatchObject({ statusCode: 409, key: "errors.labor_template_duplicate_code" })
    expect(LaborTemplateLine.create).not.toHaveBeenCalled()
    expect(LaborTemplatePosition.bulkCreate).not.toHaveBeenCalled()
})

test("inactive and unknown lines cannot be assigned; future dates and forged totals are rejected", async () => {
    mock(LaborTemplateLine.findOne).mockResolvedValue({ id: 1, isActive: false })
    await expect(service.save(undefined, body(), 1)).rejects.toMatchObject({ key: "errors.labor_line_unavailable" })
    mock(LaborTemplateLine.findOne).mockResolvedValue(null)
    await expect(service.save(undefined, { ...body(), lineCode: "UNKNOWN" }, 1)).rejects.toMatchObject({ key: "errors.labor_line_unavailable" })
    await expect(service.save(undefined, { ...body(), effectiveFrom: "3000-01-01" }, 1)).rejects.toMatchObject({ key: "errors.labor_template_future_date" })
    await expect(service.save(undefined, { ...body(), hourlyCostGtq: 1 } as SaveLaborTemplateInput, 1)).rejects.toBeDefined()
    expect(LaborTemplate.create).not.toHaveBeenCalled()
})

test("reference catalog is merged with stored edits without duplicating lines", async () => {
    mock(LaborTemplateLine.findAll).mockResolvedValue([{ ...reference.lines[0], displayName: "Changed", revision: 2 }])
    const lines = await service.listLines()
    expect(lines).toHaveLength(49)
    expect(lines.find(line => line.code === reference.lines[0].code)?.displayName).toBe("Changed")
    expect(reference.lines[0].displayName).not.toBe("Changed")
})

test("line changes require the expected version and preserve template calculations", async () => {
    const { revision, ...line } = reference.lines[0]
    const saved = await service.saveLine(line.code, { ...line, expectedVersion: revision })
    expect(saved.revision).toBe(1)
    expect(LaborTemplate.findByPk).not.toHaveBeenCalled()
    expect(LaborTemplateRevision.create).not.toHaveBeenCalled()
    mock(LaborTemplateLine.findOne).mockResolvedValue(saved)
    await expect(service.saveLine(line.code, { ...line, expectedVersion: 0 })).rejects.toMatchObject({ statusCode: 409 })
})

test("a failed snapshot write rejects the enclosing transaction", async () => {
    mock(LaborTemplateRevision.create).mockRejectedValue(new Error("snapshot failure"))
    await expect(service.save(undefined, body(), 1)).rejects.toThrow("snapshot failure")
})

test("preview uses the current Guatemala year and ignores manually supplied calendar days", () => {
    const calculation = { ...reference.settings, positions: reference.example.positions }
    const result = service.preview({ ...calculation, daysPerYear: 360 }, new Date("2026-07-01T12:00:00Z"))
    expect(result.calendarYear).toBe(2026)
    expect(result.daysPerYear).toBe(365)
    const benchmark = service.preview({ ...calculation, calendarMode: "excel_reference" }, new Date("2026-07-01T12:00:00Z"))
    expect(benchmark.calendarYear).toBeNull()
    expect(benchmark.daysPerYear).toBe(366)
    expect(benchmark.total.hourlyGtq.toFixed(4)).toBe("994.7147")
})

test("New Year updates a new calculation without changing the saved revision", async () => {
    jest.useFakeTimers({ now: new Date("2028-01-01T05:59:59Z") })
    try {
        const auto = { ...body(), calendarMode: "current_year" as const, daysPerYear: 366 }
        const original = await service.save(undefined, auto, 1)
        expect(original.daysPerYear).toBe(365)
        expect(original.calculation.calendarYear).toBe(2027)
        jest.setSystemTime(new Date("2028-01-01T06:00:00Z"))
        const historical = await service.get(original.id)
        expect(historical.calculation).toEqual(original.calculation)
        const revised = await service.save(original.id, { ...auto, daysPerYear: 365, expectedVersion: 1 }, 1)
        expect(revised.daysPerYear).toBe(366)
        expect(revised.calculation.calendarYear).toBe(2028)
        expect((await service.get(original.id, 1)).daysPerYear).toBe(365)
    } finally { jest.useRealTimers() }
})
