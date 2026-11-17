// Opt-in only: the existing harness creates and proves ownership of a new loopback cluster.
jest.mock("../../../config/env", () => {
    const raw = process.env.TEST_DATABASE_URL
    if (!raw) return { env: { databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused", nodeEnv: "test" } }
    const url = new URL(raw)
    url.pathname += "_labor"
    return { env: { databaseUrl: url.toString(), nodeEnv: "test" } }
})

import { ownedPostgresEnabled, verifyOwnedPostgres } from "../../../shared/test-utils/ownedPostgres"
import sequelize from "../../../database/connection"
import { createDatabaseSchema } from "../../../database/schemaCreation"
import User from "../../accessControl/user/models/User.model"
import LaborTemplate from "../models/LaborTemplate.model"
import LaborTemplateLine from "../models/LaborTemplateLine.model"
import LaborTemplatePosition from "../models/LaborTemplatePosition.model"
import LaborTemplateRevision from "../models/LaborTemplateRevision.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import { laborTemplateService as service } from "./laborTemplate.service"
import { getLaborReference } from "./laborTemplateReference"
import type { SaveLaborTemplateInput } from "../schemas/laborTemplate.schema"
import { laborImportService } from "./laborImport.service"
import { buildLaborImportTemplate } from "./laborImportTemplate"
import { loadWorkbookFromBuffer } from "../../../shared/utils/excelImport.util"

interface TestClient {
    connect(): Promise<void>
    end(): Promise<void>
    query(sql: string): Promise<{ rows: Record<string, unknown>[] }>
}
const { Client } = require("pg") as { Client: new (options: { connectionString: string }) => TestClient }
const reference = getLaborReference()
const input = (): SaveLaborTemplateInput => ({ ...reference.settings,
    calendarMode: "excel_reference",
    code: "T-LD1-REC", displayName: "Recorte Excel", lineCode: "1LNDTA", positions: structuredClone(reference.example.positions),
    isActive: true, effectiveFrom: "2024-01-01", changeReason: "Excel reference", expectedVersion: 0 })
const integration = ownedPostgresEnabled() ? describe : describe.skip

integration("labor templates — owned PostgreSQL", () => {
    let owner: TestClient | undefined
    let database: TestClient | undefined
    let databaseName = ""
    let created = false
    let userId: number

    beforeAll(async () => {
        owner = new Client({ connectionString: process.env.TEST_DATABASE_URL! })
        await owner.connect()
        await verifyOwnedPostgres(owner)
        databaseName = `${new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1)}_labor`
        if (!/^legumex_test_[a-f0-9]{32}_labor$/.test(databaseName)) throw Error("Unexpected labor test database")
        await owner.query(`CREATE DATABASE "${databaseName}"`)
        created = true
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.pathname = `/${databaseName}`
        database = new Client({ connectionString: url.toString() })
        await database.connect()
        await sequelize.transaction(transaction => createDatabaseSchema(sequelize, transaction))
        const user = await User.create({ name: "Synthetic test author", username: "labor-test", password: "not-a-login-account" })
        userId = user.id as number
    }, 60000)

    beforeEach(async () => {
        await database!.query('TRUNCATE "laborTemplateRevisions", "laborTemplatePositions", "laborTemplates", "laborTemplateLines" RESTART IDENTITY')
    })

    afterAll(async () => {
        await sequelize.close()
        if (database) await database.end()
        if (created) await owner!.query(`DROP DATABASE "${databaseName}"`)
        if (owner) await owner.end()
    }, 30000)

    test("stores the Excel total, 43 cost positions and the separate 32-position line", async () => {
        const saved = await service.save(undefined, input(), userId)
        expect(saved.calculation.total.hourlyGtq.toFixed(4)).toBe("994.7147")
        expect(saved.positions).toHaveLength(43)
        expect(saved.line.positions).toHaveLength(32)
        expect(await LaborTemplatePosition.count()).toBe(43)
        expect(await LaborTemplateRevision.count()).toBe(1)
        expect(Number((await LaborTemplate.findByPk(saved.id))!.hourlyCostGtq)).toBe(saved.calculation.total.hourlyGtq)
        expect(await RawMaterial.count()).toBe(0)
    })

    test("preserves historical salary and calculation snapshots after an increase", async () => {
        const first = await service.save(undefined, input(), userId)
        const change = input()
        change.expectedVersion = 1
        change.positions[0].salaryMonthlyGtq = 5000
        const next = await service.save(first.id, change, userId)
        expect(next.revision).toBe(2)
        expect(next.calculation.total.hourlyGtq).toBeGreaterThan(first.calculation.total.hourlyGtq)
        expect((await service.get(first.id, 1)).calculation).toEqual(first.calculation)
        expect((await service.get(first.id, 1)).positions[0].salaryMonthlyGtq).toBe(2921.9)
        expect(await LaborTemplatePosition.count()).toBe(43)
    })

    test("serializes concurrent edits and rejects the stale revision", async () => {
        const saved = await service.save(undefined, input(), userId)
        const change = { ...input(), expectedVersion: 1 }
        const results = await Promise.allSettled([service.save(saved.id, change, userId), service.save(saved.id, change, userId)])
        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
        const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult
        expect(rejected.reason).toMatchObject({ statusCode: 409 })
        expect(await LaborTemplateRevision.count()).toBe(2)
    })

    test("a snapshot failure rolls back line, template and positions", async () => {
        const failure = jest.spyOn(LaborTemplateRevision, "create").mockRejectedValueOnce(new Error("synthetic snapshot failure"))
        try { await expect(service.save(undefined, input(), userId)).rejects.toThrow("synthetic snapshot failure") }
        finally { failure.mockRestore() }
        expect(await LaborTemplate.count()).toBe(0)
        expect(await LaborTemplateLine.count()).toBe(0)
        expect(await LaborTemplatePosition.count()).toBe(0)
        expect(await LaborTemplateRevision.count()).toBe(0)
    })

    test("editing the catalog does not change the saved line snapshot or calculated cost", async () => {
        const saved = await service.save(undefined, input(), userId)
        const { revision, ...line } = saved.line
        await service.saveLine(line.code, { ...line, displayName: "Updated reference", positions: line.positions.slice(0, 20), expectedVersion: revision })
        const preserved = await service.get(saved.id)
        expect(preserved.line.displayName).toBe(saved.line.displayName)
        expect(preserved.line.positions).toHaveLength(32)
        expect(preserved.calculation).toEqual(saved.calculation)
    })

    test("missing author cannot leave a partially saved template", async () => {
        await expect(service.save(undefined, input(), 2147483647)).rejects.toBeDefined()
        expect(await LaborTemplate.count()).toBe(0)
        expect(await LaborTemplatePosition.count()).toBe(0)
        expect(await LaborTemplateLine.count()).toBe(0)
    })

    async function hrWorkbook() {
        const lines = reference.lines.slice(0, 2).map(line => ({ ...line, revision: 1, positions: line.positions.slice(0, 2) }))
        for (const line of lines) await LaborTemplateLine.create(line)
        const workbook = await loadWorkbookFromBuffer(await buildLaborImportTemplate(lines))
        workbook.getWorksheet("Sueldos")!.eachRow((row, index) => {
            if (index === 1) return
            row.getCell(4).value = 1000; row.getCell(5).value = 100
        })
        return Buffer.from(await workbook.xlsx.writeBuffer())
    }

    test("HR confirmation creates each template, its positions and its initial snapshot under the authenticated author", async () => {
        const buffer = await hrWorkbook()
        const preview = await laborImportService.plan(buffer)
        expect(preview.issues).toEqual([])
        expect(await LaborTemplate.count()).toBe(0)
        await expect(laborImportService.confirm(buffer, preview.previewHash, userId)).resolves.toEqual({ created: 2, positions: 4 })
        expect(await LaborTemplate.count()).toBe(2)
        expect(await LaborTemplatePosition.count()).toBe(4)
        const revisions = await LaborTemplateRevision.findAll()
        expect(revisions).toHaveLength(2)
        for (const revision of revisions) {
            expect(revision.createdByUserId).toBe(userId)
            expect(revision.revision).toBe(1)
            expect(revision.snapshot.calculation.total.monthlyGtq).toBeCloseTo(3064.511111111111, 8)
        }
    })

    test("HR import rolls back the whole batch if the second template cannot be persisted", async () => {
        const buffer = await hrWorkbook()
        const preview = await laborImportService.plan(buffer)
        const original = service.createInTransaction
        let count = 0
        const failure = jest.spyOn(service, "createInTransaction").mockImplementation((values, author, transaction, now) => {
            if (++count === 2) throw new Error("Synthetic second template failure")
            return original(values, author, transaction, now)
        })
        try { await expect(laborImportService.confirm(buffer, preview.previewHash, userId)).rejects.toThrow("Synthetic second template failure") }
        finally { failure.mockRestore() }
        expect(await LaborTemplate.count()).toBe(0)
        expect(await LaborTemplatePosition.count()).toBe(0)
        expect(await LaborTemplateRevision.count()).toBe(0)
    })

    test("concurrent HR confirmations only import the reviewed codes once", async () => {
        const buffer = await hrWorkbook()
        const preview = await laborImportService.plan(buffer)
        const results = await Promise.allSettled([laborImportService.confirm(buffer, preview.previewHash, userId), laborImportService.confirm(buffer, preview.previewHash, userId)])
        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
        expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 })
        expect(await LaborTemplate.count()).toBe(2)
        expect(await LaborTemplateRevision.count()).toBe(2)
    })

    test("an error in the last HR salary row prevents every template from being saved", async () => {
        const workbook = await loadWorkbookFromBuffer(await hrWorkbook())
        const salaries = workbook.getWorksheet("Sueldos")!
        salaries.getRow(salaries.rowCount).getCell(4).value = null
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
        const preview = await laborImportService.plan(buffer)
        expect(preview.summary.errors).toBeGreaterThan(0)
        await expect(laborImportService.confirm(buffer, preview.previewHash, userId)).rejects.toMatchObject({ name: "BulkImportError" })
        expect(await LaborTemplate.count()).toBe(0)
        expect(await LaborTemplatePosition.count()).toBe(0)
        expect(await LaborTemplateRevision.count()).toBe(0)
    })
})
