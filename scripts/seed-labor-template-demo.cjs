"use strict"
const fs = require("node:fs/promises")
const path = require("node:path")
const { createHash } = require("node:crypto")
const ExcelJS = require("exceljs")

let runtime
function loadRuntime() {
    if (runtime) return runtime
    require("reflect-metadata")
    require("ts-node").register({ project: path.resolve(__dirname, "../tsconfig.json"), transpileOnly: true })
    const base = "../src/features/rawMaterialTransformation/"
    runtime = {
        ...require(base + "services/laborTemplateReference"),
        ...require(base + "services/laborTemplateCalendar"),
        ...require(base + "services/laborTemplateCalculation"),
        ...require(base + "schemas/laborTemplate.schema"),
        ...require("../src/shared/utils/businessTime.util"),
    }
    return runtime
}

async function readWorkbook(input) {
    const bytes = Buffer.isBuffer(input) ? input : await fs.readFile(input)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes)
    const lineSheet = workbook.getWorksheet("Lineas"), positionSheet = workbook.getWorksheet("Posiciones")
    if (!lineSheet || !positionSheet) throw Error("Expected Lineas and Posiciones worksheets")
    const lines = new Map(), positions = new Set()
    lineSheet.eachRow((row, index) => {
        if (index === 1 || !row.getCell(1).text.trim()) return
        const code = row.getCell(1).text.trim().toUpperCase()
        if (lines.has(code)) throw Error(`Duplicate line at row ${index}`)
        lines.set(code, { code, displayName: row.getCell(2).text.trim(), shift: row.getCell(3).text.trim().toUpperCase(), positions: [] })
    })
    positionSheet.eachRow((row, index) => {
        if (index === 1 || !row.getCell(1).text.trim()) return
        const line = lines.get(row.getCell(1).text.trim().toUpperCase())
        const code = row.getCell(2).text.trim().toUpperCase()
        if (!line || positions.has(code)) throw Error(`Orphan or duplicate position at row ${index}`)
        positions.add(code)
        line.positions.push({ code, jobTitle: row.getCell(3).text.trim() })
    })
    if (!lines.size || !positions.size) throw Error("The workbook contains no lines or positions")
    return { sha256: createHash("sha256").update(bytes).digest("hex"), lines: [...lines.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "es", { numeric: true })) }
}

function buildPlan(source, now = new Date()) {
    const tools = loadRuntime(), reference = tools.getLaborReference()
    const salary = reference.example.positions[0].salaryMonthlyGtq
    const bonus = reference.example.positions[0].bonusMonthlyGtq
    const calendar = tools.resolveLaborCalendar("current_year", now)
    const templates = source.lines.map(sourceLine => {
        const line = tools.saveLaborLineSchema.parse({ ...sourceLine, plantName: reference.plantName, isActive: true, expectedVersion: 0 })
        line.positions.sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }))
        const input = tools.saveLaborTemplateSchema.parse({
            code: `TEST-${line.code}`, displayName: `PLANTILLA ${line.displayName}`, lineCode: line.code,
            isActive: true, effectiveFrom: tools.businessDayKey(now), expectedVersion: 0,
            changeReason: "Validación local Planta 1 / Tejar: salarios, bono y prestaciones replicados del ejemplo Excel.",
            calendarMode: calendar.calendarMode, daysPerYear: calendar.daysPerYear, weeklyHours: reference.settings.weeklyHours,
            benefits: structuredClone(reference.settings.benefits),
            positions: line.positions.map(position => ({ ...position, salaryMonthlyGtq: salary, bonusMonthlyGtq: bonus,
                isActive: true, applicableBenefitCodes: reference.settings.benefits.map(benefit => benefit.code) })),
        })
        return { line, input, calculation: tools.calculateLaborTemplate({ calendarMode: input.calendarMode, daysPerYear: input.daysPerYear,
            weeklyHours: input.weeklyHours, benefits: input.benefits, positions: input.positions }, calendar.calendarYear) }
    })
    return { sourceSha256: source.sha256, calendar, salaryMonthlyGtq: salary, bonusMonthlyGtq: bonus,
        templateCount: templates.length, positionCount: templates.reduce((count, template) => count + template.input.positions.length, 0), templates }
}

// This guard is evaluated before constructing a database connection.
function assertDestination(urlText, options) {
    const url = new URL(urlText)
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    const database = decodeURIComponent(url.pathname.slice(1))
    const local = ["localhost", "127.0.0.1", "::1"].includes(host)
    if (options.expectedHost !== host || options.expectedDatabase !== database) throw Error("Expected host and database must exactly match the selected connection")
    if (!local && !options.allowRemoteTestData) throw Error("The selected database is remote; local test-data authorization does not cover it")
    return { host, database, local }
}

function comparable(input) {
    return Object.fromEntries(["code", "displayName", "lineCode", "isActive", "calendarMode", "daysPerYear", "weeklyHours", "benefits", "positions"].map(key => [key, input[key]]))
}

function stableJson(value) {
    if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(stableJson(item))))
    if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, JSON.parse(stableJson(value[key]))])))
    return JSON.stringify(value)
}

async function applyPlan(plan, urlText, options, ca) {
    const destination = assertDestination(urlText, options)
    loadRuntime()
    const { Sequelize } = require("sequelize-typescript")
    const { QueryTypes, Op } = require("sequelize")
    const { parseDatabaseConnection } = require("../src/config/databaseConnection")
    const { databaseModels } = require("../src/database/models")
    const target = parseDatabaseConnection(urlText, "development", ca)
    const db = new Sequelize(target.database, target.username, target.password, { dialect: "postgres", host: target.host, port: target.port,
        logging: false, models: databaseModels, dialectOptions: { ssl: target.ssl, connectionTimeoutMillis: 10000 } })
    const model = name => db.model(name)
    const Line = model("LaborTemplateLine"), Template = model("LaborTemplate"), Position = model("LaborTemplatePosition"), Revision = model("LaborTemplateRevision")
    try {
        return await db.transaction(async transaction => {
            await db.query("SET LOCAL lock_timeout='5000ms'", { transaction })
            await db.query("SET LOCAL statement_timeout='60000ms'", { transaction })
            await db.query("SELECT pg_advisory_xact_lock(174226, 3)", { transaction })
            const identity = (await db.query("SELECT current_database() AS database, inet_server_addr()::text AS address", { type: QueryTypes.SELECT, transaction }))[0]
            if (identity.database !== destination.database || destination.local && !["127.0.0.1", "::1"].includes(identity.address)) throw Error("Live database identity did not match the authorized destination")
            const tables = new Set((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'", { type: QueryTypes.SELECT, transaction })).map(row => row.tablename))
            for (const table of ["users", "roles", "permissions", "role_permissions"]) if (!tables.has(table)) throw Error("The selected database needs the existing Legumex authentication schema first")
            const admin = await model("User").findOne({ attributes: ["id", "role_id"], where: { isActive: true }, include: [{ model: model("Role"), as: "role", attributes: ["id", "name"], where: { name: "Administrador", isActive: true } }], order: [["id", "ASC"]], transaction })
            if (!admin) throw Error("No active administrator exists in the selected database to author the template revisions")
            const createdTables = []
            for (const item of [Line, Template, Position, Revision]) {
                const table = item.getTableName()
                if (!tables.has(table)) { await item.sync({ alter: false, force: false, transaction }); createdTables.push(table) }
                const columns = await db.getQueryInterface().describeTable(table, { transaction })
                if (Object.keys(item.rawAttributes).some(field => !columns[field])) throw Error(`Incompatible existing table: ${table}`)
            }
            const codes = plan.templates.map(item => item.input.code)
            const existing = await Template.findAll({ where: { code: { [Op.in]: codes } }, transaction })
            const byCode = new Map(existing.map(item => [item.code, item]))
            let created = 0, skipped = 0
            for (const item of plan.templates) {
                const previous = byCode.get(item.input.code)
                if (previous) {
                    const revision = await Revision.findOne({ where: { templateId: previous.id, revision: previous.revision }, transaction })
                    if (!revision || stableJson(comparable(revision.snapshot.input)) !== stableJson(comparable(item.input))) throw Error(`Existing template differs; it was not overwritten: ${item.input.code}`)
                    skipped++
                    continue
                }
                let line = await Line.findOne({ where: { code: item.line.code }, transaction, lock: transaction.LOCK.UPDATE })
                const { expectedVersion, ...lineFields } = item.line
                if (line && (!line.isActive || stableJson(line.positions) !== stableJson(lineFields.positions))) throw Error(`Existing line differs; it was not overwritten: ${item.line.code}`)
                if (!line) line = await Line.create({ ...lineFields, revision: 1 }, { transaction })
                const input = item.input, calculation = item.calculation
                const template = await Template.create({ code: input.code, displayName: input.displayName, lineId: line.id, daysPerYear: input.daysPerYear,
                    weeklyHours: input.weeklyHours, benefits: input.benefits, effectiveFrom: input.effectiveFrom, isActive: true, revision: 1,
                    hourlyCostGtq: calculation.total.hourlyGtq, includedPositions: calculation.includedPositions }, { transaction })
                await Position.bulkCreate(input.positions.map((position, sortOrder) => ({ ...position, templateId: template.id, sortOrder })), { transaction })
                await Revision.create({ templateId: template.id, revision: 1, createdByUserId: admin.id, effectiveFrom: input.effectiveFrom, changeReason: input.changeReason,
                    snapshot: { input: { ...input, expectedVersion: 1 }, line: { code: line.code, displayName: line.displayName, plantName: line.plantName, shift: line.shift, isActive: line.isActive, positions: line.positions, revision: line.revision }, calculation } }, { transaction })
                created++
            }
            const names = ["laborTemplates:view", "laborTemplates:create", "laborTemplates:edit"]
            await model("Permission").bulkCreate(names.map(name => ({ name, isActive: true })), { ignoreDuplicates: true, transaction })
            const permissions = await model("Permission").findAll({ where: { name: names }, transaction })
            if (permissions.some(permission => !permission.isActive)) throw Error("A required labor permission was intentionally inactive; no changes were applied")
            await model("RolePermission").bulkCreate(permissions.map(permission => ({ role_id: admin.role_id, permission_id: permission.id })), { ignoreDuplicates: true, transaction })
            const saved = await Template.findAll({ where: { code: { [Op.in]: codes } }, transaction })
            const positions = await Position.count({ where: { templateId: { [Op.in]: saved.map(item => item.id) } }, transaction })
            if (saved.length !== plan.templateCount || positions !== plan.positionCount) throw Error("Saved template/position counts did not match the workbook")
            return { destination, createdTables, created, skipped, templates: saved.length, positions, authorUserId: admin.id,
                calendar: plan.calendar, salaryMonthlyGtq: plan.salaryMonthlyGtq, bonusMonthlyGtq: plan.bonusMonthlyGtq }
        })
    } finally { await db.close() }
}

async function writeSummary(plan, filename) {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Plantillas de prueba")
    sheet.columns = [
        { header: "CÓDIGO PLANTILLA", key: "code", width: 20 }, { header: "LÍNEA", key: "line", width: 60 },
        { header: "TURNO", key: "shift", width: 10 }, { header: "POSICIONES", key: "count", width: 14 },
        { header: "SALARIO MENSUAL", key: "salary", width: 20 }, { header: "BONO DECRETO", key: "bonus", width: 18 },
        { header: "AÑO", key: "year", width: 10 }, { header: "DÍAS", key: "days", width: 10 },
        { header: "HORAS SEMANALES", key: "hours", width: 20 }, { header: "COSTO ANUAL GTQ", key: "annual", width: 22 },
        { header: "COSTO SEMANAL GTQ", key: "weekly", width: 22 }, { header: "COSTO HORA GTQ", key: "hourly", width: 22 },
    ]
    for (const item of plan.templates) sheet.addRow({ code: item.input.code, line: item.line.displayName, shift: item.line.shift,
        count: item.input.positions.length, salary: plan.salaryMonthlyGtq, bonus: plan.bonusMonthlyGtq, year: plan.calendar.calendarYear,
        days: plan.calendar.daysPerYear, hours: item.input.weeklyHours, annual: item.calculation.total.annualGtq,
        weekly: item.calculation.total.weeklyGtq, hourly: item.calculation.total.hourlyGtq })
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: "A1", to: `L${sheet.rowCount}` }
    sheet.getRow(1).font = { bold: true }
    for (const column of [5, 6, 10, 11]) sheet.getColumn(column).numFmt = '"Q"#,##0.00'
    sheet.getColumn(12).numFmt = '"Q"#,##0.0000'
    const notes = workbook.addWorksheet("Parámetros")
    notes.columns = [{ width: 85 }, { width: 24 }]
    notes.addRows([["DATOS SIMULADOS PARA VALIDACIÓN LOCAL"], ["Fuente", "LINEAS Y POSICIONES PLANTA 1.xlsx"],
        ["Los salarios y bonos se replicaron del ejemplo, por autorización del usuario."],
        ["No representan salarios vigentes ni empleados activos."], ["Planta", "Planta 1 / Tejar"],
        ["Días del año", plan.calendar.daysPerYear], ["Calendario", "Año actual de Guatemala"]])
    for (const benefit of plan.templates[0].input.benefits) notes.addRow([`${benefit.displayName} — base salario`, benefit.percentage / 100]).getCell(2).numFmt = "0.0000000000%"
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await workbook.xlsx.writeFile(filename)
}

async function main(args) {
    const options = {}
    for (let index = 0; index < args.length; index++) {
        const key = args[index]
        if (["--apply", "--allow-remote-test-data"].includes(key)) options[key] = true
        else if (["--excel", "--report", "--summary", "--env-file", "--expected-host", "--expected-database"].includes(key) && args[index + 1]) options[key] = args[++index]
        else throw Error("Unknown or incomplete argument")
    }
    if (!options["--excel"] || !options["--report"]) throw Error("Required: --excel <source.xlsx> --report <report.json>; optional --summary <summary.xlsx>")
    const plan = buildPlan(await readWorkbook(options["--excel"]))
    await fs.mkdir(path.dirname(path.resolve(options["--report"])), { recursive: true })
    await fs.writeFile(options["--report"], JSON.stringify({ applied: false, plan }, null, 2))
    if (options["--summary"]) await writeSummary(plan, options["--summary"])
    let applied
    if (options["--apply"]) {
        const dotenv = require("dotenv")
        const config = dotenv.parse(await fs.readFile(options["--env-file"] || path.resolve(__dirname, "../src/config/.env")))
        const url = config.DATABASE_URL
        if (!url) throw Error("DATABASE_URL is missing from the explicitly selected environment file")
        applied = await applyPlan(plan, url, { expectedHost: options["--expected-host"], expectedDatabase: options["--expected-database"], allowRemoteTestData: !!options["--allow-remote-test-data"] }, config.DATABASE_CA_CERT)
        await fs.writeFile(options["--report"], JSON.stringify({ applied: true, result: applied, plan }, null, 2))
    }
    console.log(JSON.stringify(applied || { applied: false, templates: plan.templateCount, positions: plan.positionCount,
        calendar: plan.calendar, salaryMonthlyGtq: plan.salaryMonthlyGtq, bonusMonthlyGtq: plan.bonusMonthlyGtq }))
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.original?.code ? `Database operation failed (${error.original.code}); the transaction was rolled back.` : error.message); process.exitCode = 1 })
module.exports = { readWorkbook, buildPlan, assertDestination, comparable, stableJson, applyPlan, writeSummary }
