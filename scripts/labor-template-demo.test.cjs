const { test } = require("node:test")
const assert = require("node:assert/strict")
const ExcelJS = require("exceljs")
const { readWorkbook, buildPlan, assertDestination, comparable, stableJson } = require("./seed-labor-template-demo.cjs")

async function fixture({ orphan = false, duplicate = false, shift = "AM" } = {}) {
    const workbook = new ExcelJS.Workbook()
    const lines = workbook.addWorksheet("Lineas")
    lines.addRows([["CÓDIGO", "NOMBRE", "TURNO"], ["LA", "Línea A", shift], ["LB", "Línea B", "PM"]])
    const positions = workbook.addWorksheet("Posiciones")
    positions.addRows([["CÓDIGO DE LÍNEA", "CÓDIGO", "ACTIVIDAD"], ["LA", "LA001", "Supervisor"], ["LA", duplicate ? "LA001" : "LA002", "Recortador"], [orphan ? "UNKNOWN" : "LB", "LB001", "Operario"]])
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

test("reads line/position relationships and creates one complete cost template per line", async () => {
    const plan = buildPlan(await readWorkbook(await fixture()), new Date("2026-11-15T12:00:00Z"))
    assert.equal(plan.templateCount, 2)
    assert.equal(plan.positionCount, 3)
    assert.equal(plan.salaryMonthlyGtq, 2921.9)
    assert.equal(plan.bonusMonthlyGtq, 250)
    assert.deepEqual(plan.templates.map(item => item.input.positions.length), [2, 1])
    assert.equal(plan.calendar.daysPerYear, 365)
    for (const { input, calculation } of plan.templates) {
        assert.equal(input.calendarMode, "current_year")
        assert.equal(input.weeklyHours, 44)
        assert.equal(input.benefits.length, 5)
        assert.equal(input.expectedVersion, 0)
        assert.ok(input.positions.every(position => position.salaryMonthlyGtq === 2921.9 && position.bonusMonthlyGtq === 250 && position.isActive))
        assert.equal(calculation.calendarYear, 2026)
    }
    assert.ok(Math.abs(plan.templates[0].calculation.total.hourlyGtq - 2 * plan.templates[1].calculation.total.hourlyGtq) < 1e-8)
})

test("rejects orphan/duplicate positions and unknown shifts before any database action", async () => {
    await assert.rejects(readWorkbook(await fixture({ orphan: true })), /Orphan/)
    await assert.rejects(readWorkbook(await fixture({ duplicate: true })), /duplicate/)
    assert.throws(() => buildPlan({ lines: [{ code: "A", displayName: "A", shift: "NIGHT", positions: [{ code: "A1", jobTitle: "A" }] }] }))
})

test("the demo uses 366 days in a leap year, without mutating another template's benefits", async () => {
    const plan = buildPlan(await readWorkbook(await fixture()), new Date("2028-07-01T12:00:00Z"))
    assert.equal(plan.calendar.daysPerYear, 366)
    plan.templates[0].input.benefits[0].percentage = 0
    assert.ok(plan.templates[1].input.benefits[0].percentage > 0)
})

test("local authorization cannot accidentally connect to Render or a mismatched database", () => {
    const local = "postgres://synthetic:synthetic@127.0.0.1:5432/local_test"
    assert.equal(assertDestination(local, { expectedHost: "127.0.0.1", expectedDatabase: "local_test" }).local, true)
    const remote = "postgres://synthetic:synthetic@example.invalid:5432/remote_test?sslmode=verify-full"
    assert.throws(() => assertDestination(remote, { expectedHost: "example.invalid", expectedDatabase: "remote_test" }), /remote/)
    assert.throws(() => assertDestination(local, { expectedHost: "127.0.0.1", expectedDatabase: "other" }), /exactly match/)
})

test("repeated loading compares JSONB values independently of key ordering, without hiding salary differences", async () => {
    const input = buildPlan(await readWorkbook(await fixture())).templates[0].input
    const reordered = JSON.parse(JSON.stringify(input))
    reordered.positions = reordered.positions.map(position => Object.fromEntries(Object.entries(position).reverse()))
    reordered.expectedVersion = 1
    reordered.effectiveFrom = "2024-01-01"
    assert.equal(stableJson(comparable(input)), stableJson(comparable(reordered)))
    reordered.positions[0].salaryMonthlyGtq += 1
    assert.notEqual(stableJson(comparable(input)), stableJson(comparable(reordered)))
})
