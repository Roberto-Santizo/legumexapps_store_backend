import type { Transaction } from "sequelize"
import { createHash } from "node:crypto"
import sequelize from "../../../database/connection"
import { AppError, BulkImportError } from "../../../shared/errors/AppError"
import { digest } from "../../../shared/utils/digest.util"
import { businessDayKey } from "../../../shared/utils/businessTime.util"
import { loadWorkbookFromBuffer } from "../../../shared/utils/excelImport.util"
import LaborTemplate from "../models/LaborTemplate.model"
import { laborTemplateService } from "./laborTemplate.service"
import { resolveLaborCalendar } from "./laborTemplateCalendar"
import { planLaborWorkbook } from "./laborImportPlan"
import { buildLaborImportTemplate } from "./laborImportTemplate"
import { getLaborReference } from "./laborTemplateReference"

async function template() {
    return buildLaborImportTemplate(await laborTemplateService.listLines())
}

async function plan(buffer: Buffer, transaction?: Transaction, now = new Date()) {
    const workbook = await loadWorkbookFromBuffer(buffer, { requireStyles: true })
    const lines = await laborTemplateService.listLines(transaction)
    const existing = (await LaborTemplate.findAll({ attributes: ["code"], transaction })).map(template => template.code).sort()
    const calendar = resolveLaborCalendar("current_year", now)
    const settings = getLaborReference().settings
    const result = planLaborWorkbook(workbook, lines, existing, now, settings)
    const previewHash = digest({ version: 2, file: createHash("sha256").update(buffer).digest("hex"), lines, existing, calendar, effectiveFrom: businessDayKey(now), settings })
    return { ...result, previewHash }
}

async function confirm(buffer: Buffer, previewHash: string, userId: number) {
    if (!/^[a-f0-9]{64}$/.test(previewHash)) throw new AppError(422, "errors.labor_import_changed")
    return sequelize.transaction(async transaction => {
        // Same lock as individual labor-template and line writes; no nested transactions.
        await sequelize.query("SELECT pg_advisory_xact_lock(174226, 3)", { transaction })
        const now = new Date()
        const result = await plan(buffer, transaction, now)
        if (result.previewHash !== previewHash) throw new AppError(409, "errors.labor_import_changed")
        if (result.issues.length) throw new BulkImportError(result.issues)
        for (const entry of result.plans) await laborTemplateService.createInTransaction(entry.input, userId, transaction, now)
        return { created: result.plans.length, positions: result.summary.positions }
    })
}

export const laborImportService = { template, plan, confirm }
