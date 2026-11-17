import { Op, type Transaction } from "sequelize"
import sequelize from "../../../database/connection"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { businessDayKey } from "../../../shared/utils/businessTime.util"
import { paginate, type PaginationParams, type PaginatedResult } from "../../../shared/utils/pagination.util"
import LaborTemplate from "../models/LaborTemplate.model"
import LaborTemplateLine from "../models/LaborTemplateLine.model"
import LaborTemplatePosition from "../models/LaborTemplatePosition.model"
import LaborTemplateRevision from "../models/LaborTemplateRevision.model"
import type { LaborRevisionSnapshot } from "../models/LaborTemplateRevision.model"
import { saveLaborLineSchema, saveLaborTemplateSchema } from "../schemas/laborTemplate.schema"
import type { LaborCalculationInput, SaveLaborLineInput, SaveLaborTemplateInput } from "../schemas/laborTemplate.schema"
import { calculateLaborTemplate } from "./laborTemplateCalculation"
import { getLaborReference } from "./laborTemplateReference"
import { resolveLaborCalendar } from "./laborTemplateCalendar"

const reference = getLaborReference()
const referenceLines = new Map(reference.lines.map(line => [line.code, line]))
const conflict = () => new AppError(409, "errors.labor_template_version_conflict")

async function lockWrites(transaction: Transaction) {
    // Separate from transformation writes: no PCS recalculation or rawMaterials updates.
    await sequelize.query("SELECT pg_advisory_xact_lock(174226, 3)", { transaction })
}

function lineDto(line: LaborTemplateLine) {
    return {
        code: line.code, displayName: line.displayName, plantName: line.plantName,
        shift: line.shift, isActive: line.isActive, positions: line.positions, revision: line.revision,
    }
}

async function listLines(transaction?: Transaction) {
    const lines = new Map(reference.lines.map(line => [line.code, line]))
    for (const line of await LaborTemplateLine.findAll({ transaction })) lines.set(line.code, lineDto(line))
    return [...lines.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "es", { numeric: true }) || a.code.localeCompare(b.code))
}

async function saveLine(lineCode: string, values: SaveLaborLineInput) {
    const input = saveLaborLineSchema.parse(values)
    if (input.code !== lineCode.toUpperCase()) throw new AppError(422, "errors.labor_line_code_mismatch")
    return sequelize.transaction(async transaction => {
        await lockWrites(transaction)
        const line = await LaborTemplateLine.findOne({ where: { code: input.code }, transaction, lock: transaction.LOCK.UPDATE })
        if ((line?.revision ?? 0) !== input.expectedVersion) throw conflict()
        const { expectedVersion, ...fields } = input
        const record = line
            ? await line.update({ ...fields, revision: expectedVersion + 1 }, { transaction })
            : await LaborTemplateLine.create({ ...fields, revision: 1 }, { transaction })
        return lineDto(record)
    })
}

async function resolveLine(code: string, transaction: Transaction) {
    let line = await LaborTemplateLine.findOne({ where: { code }, transaction, lock: transaction.LOCK.UPDATE })
    if (!line) {
        const source = referenceLines.get(code)
        if (!source) throw new AppError(422, "errors.labor_line_unavailable")
        line = await LaborTemplateLine.create({ ...source, revision: 1 }, { transaction })
    }
    if (!line.isActive) throw new AppError(422, "errors.labor_line_unavailable")
    return line
}

interface LaborTemplateListItem {
    id: number
    code: string
    displayName: string
    lineCode: string
    lineName: string
    shift: "AM" | "PM"
    isActive: boolean
    revision: number
    hourlyCostGtq: number
    includedPositions: number
    effectiveFrom: string
    updatedAt: Date
}

async function list(pagination: PaginationParams, search?: string): Promise<PaginatedResult<LaborTemplateListItem>> {
    const result = await paginate(LaborTemplate, {
        where: search ? { [Op.or]: [{ code: { [Op.iLike]: `%${search}%` } }, { displayName: { [Op.iLike]: `%${search}%` } }] } : undefined,
        include: [{ model: LaborTemplateLine, as: "line" }],
        order: [["isActive", "DESC"], ["displayName", "ASC"], ["id", "ASC"]],
    }, pagination)
    return { ...result, data: result.data.map(row => ({
        id: row.id as number, code: row.code, displayName: row.displayName, lineCode: row.line.code,
        lineName: row.line.displayName, shift: row.line.shift, isActive: row.isActive,
        revision: row.revision, hourlyCostGtq: Number(row.hourlyCostGtq), includedPositions: row.includedPositions,
        effectiveFrom: row.effectiveFrom, updatedAt: row.updatedAt as Date,
    })) }
}

async function readTemplate(id: number) {
    const template = await LaborTemplate.findByPk(id)
    if (!template) throw new NotFoundError("LaborTemplate", id)
    return template
}

async function get(id: number, revision?: number) {
    const template = await readTemplate(id)
    const record = await LaborTemplateRevision.findOne({ where: { templateId: id, revision: revision ?? template.revision } })
    if (!record) throw new NotFoundError("LaborTemplateRevision", revision ?? template.revision)
    return {
        id, ...record.snapshot.input, expectedVersion: record.revision, revision: record.revision,
        line: record.snapshot.line, calculation: record.snapshot.calculation,
        createdByUserId: record.createdByUserId, savedAt: record.createdAt as Date,
    }
}

async function revisions(id: number) {
    await readTemplate(id)
    return LaborTemplateRevision.findAll({
        where: { templateId: id }, attributes: ["revision", "effectiveFrom", "changeReason", "createdByUserId", "createdAt"],
        order: [["revision", "DESC"]],
    })
}

function preview(values: LaborCalculationInput, now = new Date()) {
    const calendar = resolveLaborCalendar(values.calendarMode, now)
    return calculateLaborTemplate({ ...values, calendarMode: calendar.calendarMode, daysPerYear: calendar.daysPerYear }, calendar.calendarYear)
}

function prepareSave(values: SaveLaborTemplateInput, now: Date) {
    const parsed = saveLaborTemplateSchema.parse(values)
    const calendar = resolveLaborCalendar(parsed.calendarMode, now)
    const input = { ...parsed, calendarMode: calendar.calendarMode, daysPerYear: calendar.daysPerYear }
    if (input.effectiveFrom > businessDayKey(now)) throw new AppError(422, "errors.labor_template_future_date")
    const calculation = preview({ calendarMode: input.calendarMode, daysPerYear: input.daysPerYear, weeklyHours: input.weeklyHours, benefits: input.benefits, positions: input.positions }, now)
    return { input, calculation }
}

async function persistTemplate(id: number | undefined, prepared: ReturnType<typeof prepareSave>, userId: number, transaction: Transaction) {
    const { input, calculation } = prepared
    const existing = id ? await LaborTemplate.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }) : null
    if (id && !existing) throw new NotFoundError("LaborTemplate", id)
    if ((existing?.revision ?? 0) !== input.expectedVersion) throw conflict()
    const duplicate = await LaborTemplate.findOne({ where: { code: input.code, ...(id ? { id: { [Op.ne]: id } } : {}) }, transaction })
    if (duplicate) throw new AppError(409, "errors.labor_template_duplicate_code")
    const line = await resolveLine(input.lineCode, transaction)
    const revision = input.expectedVersion + 1
    const fields = {
        code: input.code, displayName: input.displayName, lineId: line.id as number,
        daysPerYear: input.daysPerYear, weeklyHours: input.weeklyHours, benefits: input.benefits,
        effectiveFrom: input.effectiveFrom, isActive: input.isActive, revision,
        hourlyCostGtq: calculation.total.hourlyGtq, includedPositions: calculation.includedPositions,
    }
    const template = existing ? await existing.update(fields, { transaction }) : await LaborTemplate.create(fields, { transaction })
    if (existing) await LaborTemplatePosition.destroy({ where: { templateId: template.id }, transaction })
    await LaborTemplatePosition.bulkCreate(input.positions.map((position, sortOrder) => ({ ...position, templateId: template.id, sortOrder })), { transaction })
    const snapshot: LaborRevisionSnapshot = { input: { ...input, expectedVersion: revision }, line: lineDto(line), calculation }
    await LaborTemplateRevision.create({ templateId: template.id, revision, createdByUserId: userId, effectiveFrom: input.effectiveFrom, changeReason: input.changeReason, snapshot }, { transaction })
    return template.id as number
}

async function save(id: number | undefined, values: SaveLaborTemplateInput, userId: number) {
    const now = new Date()
    // Validate before opening the transaction, as in the individual form flow.
    const prepared = prepareSave(values, now)
    const savedId = await sequelize.transaction(async transaction => {
        await lockWrites(transaction)
        return persistTemplate(id, prepared, userId, transaction)
    })
    return get(savedId)
}

async function createInTransaction(values: SaveLaborTemplateInput, userId: number, transaction: Transaction, now: Date) {
    if (values.expectedVersion !== 0) throw conflict()
    return persistTemplate(undefined, prepareSave(values, now), userId, transaction)
}

export const laborTemplateService = { reference: getLaborReference, listLines, saveLine, list, get, revisions, save, preview, createInTransaction }
