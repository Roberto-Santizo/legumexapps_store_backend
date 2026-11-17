const fs = require("node:fs/promises")
const path = require("node:path")
const { createHash } = require("node:crypto")
const ExcelJS = require("exceljs")

// Offline preparation only. Never connects to PostgreSQL or changes either source workbook.
async function prepare(linesPath, examplePath, workbookPath) {
    const catalog = new ExcelJS.Workbook()
    const example = new ExcelJS.Workbook()
    await catalog.xlsx.readFile(linesPath)
    await example.xlsx.readFile(examplePath)
    const lines = []
    catalog.getWorksheet("Lineas").eachRow((row, index) => {
        if (index > 1 && row.getCell(1).text.trim()) lines.push({
            code: row.getCell(1).text.trim(), displayName: row.getCell(2).text.trim(),
            shift: row.getCell(3).text.trim(), sourceRow: index, positions: [],
        })
    })
    const byCode = new Map(lines.map(line => [line.code, line]))
    if (byCode.size !== lines.length) throw Error("Duplicate line codes")
    const positionCodes = new Set()
    catalog.getWorksheet("Posiciones").eachRow((row, index) => {
        if (index === 1 || !row.getCell(1).text.trim()) return
        const line = byCode.get(row.getCell(1).text.trim())
        const code = row.getCell(2).text.trim()
        if (!line || positionCodes.has(code) || !code.startsWith(line.code)) throw Error(`Invalid position at row ${index}`)
        positionCodes.add(code)
        line.positions.push({ code, jobTitle: row.getCell(3).text.trim(), sourceRow: index })
    })
    const compare = (a, b) => a.localeCompare(b, "es", { numeric: true })
    lines.sort((a, b) => compare(a.displayName, b.displayName) || compare(a.code, b.code))
    lines.forEach(line => line.positions.sort((a, b) => compare(a.code, b.code)))
    const sheet = example.getWorksheet("EJEMPLO PLANTILLA")
    const positions = []
    for (let row = 4; row <= 46; row++) positions.push({
        code: sheet.getCell(`B${row}`).text.trim(), jobTitle: sheet.getCell(`D${row}`).text.trim(),
        salaryMonthlyGtq: sheet.getCell(`E${row}`).value, bonusMonthlyGtq: sheet.getCell(`G${row}`).value,
        isActive: true, applicableBenefitCodes: ["BONO14", "AGUINALDO", "INDEMNIZACION", "VACACIONES", "PATRONAL"],
    })
    const benefits = [
        ["BONO14", "Bono 14", 58], ["AGUINALDO", "Aguinaldo", 59], ["INDEMNIZACION", "Indemnización", 60],
        ["VACACIONES", "Vacaciones", 61], ["PATRONAL", "Cuota patronal", 62],
    ].map(([code, displayName, row]) => {
        const cell = sheet.getCell(`G${row}`)
        return { code, displayName, percentage: (cell.result ?? cell.value) * 100, basis: "salary", isActive: true }
    })
    const fingerprint = async filename => createHash("sha256").update(await fs.readFile(filename)).digest("hex")
    const reference = {
        plantName: "Planta 1 / Tejar",
        sources: [
            { filename: path.basename(linesPath), sha256: await fingerprint(linesPath), sheets: ["Lineas", "Posiciones"] },
            { filename: path.basename(examplePath), sha256: await fingerprint(examplePath), sheets: ["RECETA", "HOJA TÉCNICA COSTOS", "EJEMPLO PLANTILLA"] },
        ],
        settings: { daysPerYear: 366, weeklyHours: 44, benefits },
        lines,
        example: { code: "T-LD1-REC", displayName: "Plantilla Línea Directa 1 Recorte — ejemplo Excel", lineCode: "1LNDTA", positions,
            expectedHourlyCostGtq: sheet.getCell("E55").result, sourceSheet: "EJEMPLO PLANTILLA", sourceRange: "B3:G63" },
    }
    const target = path.resolve(__dirname, "../src/features/rawMaterialTransformation/constants/tejarLaborReference.json")
    await fs.writeFile(target, JSON.stringify(reference, null, 2) + "\n")
    if (workbookPath) {
        const output = new ExcelJS.Workbook()
        const summary = output.addWorksheet("Lineas")
        summary.columns = [{ header: "CÓDIGO", key: "code", width: 16 }, { header: "NOMBRE", key: "displayName", width: 60 },
            { header: "TURNO", key: "shift", width: 12 }, { header: "POSICIONES REGISTRADAS", key: "count", width: 25 },
            { header: "FILA ORIGINAL", key: "sourceRow", width: 18 }]
        lines.forEach(line => summary.addRow({ ...line, count: line.positions.length }))
        const details = output.addWorksheet("Posiciones")
        details.columns = [{ header: "CÓDIGO DE LÍNEA", key: "lineCode", width: 18 }, { header: "LÍNEA", key: "lineName", width: 60 },
            { header: "TURNO", key: "shift", width: 12 }, { header: "NO. POSICIÓN", key: "code", width: 20 },
            { header: "PUESTO / ACTIVIDAD", key: "jobTitle", width: 40 }, { header: "FILA ORIGINAL", key: "sourceRow", width: 18 }]
        lines.forEach(line => line.positions.forEach(position => details.addRow({ ...position, lineCode: line.code, lineName: line.displayName, shift: line.shift })))
        const notes = output.addWorksheet("Notas")
        notes.columns = [{ width: 120 }]
        notes.addRows([["PLANTA 1 / TEJAR — CATÁLOGO ORDENADO"], [`${lines.length} líneas; ${positionCodes.size} posiciones. No representan empleados activos.`],
            ["Se conservaron códigos, nombres, puestos y turnos. Solo se eliminaron espacios exteriores y se ordenaron las filas."],
            ["El ejemplo salarial contiene 43 posiciones para 1LNDTA; el catálogo contiene 32. No se fusionaron."],
            ["Las cifras entre paréntesis en los nombres no sustituyen el conteo de posiciones registradas."],
            ["El catálogo de líneas no contiene salarios. Q2,921.90 y Q250 pertenecen exclusivamente al ejemplo salarial."],
            ["La columna UNIDAD DE MEDIDA del archivo original está vacía en las 713 posiciones."],
            ["RECETA: resumen de costos; HOJA TÉCNICA COSTOS: HH = hora de utilización de la plantilla completa."],
            ["EJEMPLO PLANTILLA: prestaciones sobre salario, anualización ×12, semanas 366/7, jornada 44 horas."],
            ["El multiplicador de F4 es 0.432255555555556; G63 suma las cinco provisiones sin redondear a 43.23%."]])
        for (const tab of [summary, details]) {
            tab.views = [{ state: "frozen", ySplit: 1 }]
            tab.autoFilter = { from: "A1", to: { row: tab.rowCount, column: tab.columnCount } }
            tab.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
            tab.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B4A" } }
        }
        await fs.mkdir(path.dirname(workbookPath), { recursive: true })
        await output.xlsx.writeFile(workbookPath)
    }
    console.log(`Prepared ${lines.length} lines, ${positionCodes.size} catalog positions and ${positions.length} example positions.`)
}

if (require.main === module) {
    const [linesPath, examplePath, workbookPath] = process.argv.slice(2)
    if (!linesPath || !examplePath) throw Error("Usage: node scripts/prepare-tejar-labor-reference.cjs <lines.xlsx> <example.xlsx> [ordered-output.xlsx]")
    prepare(linesPath, examplePath, workbookPath).catch(error => { console.error(error.message); process.exitCode = 1 })
}

module.exports = { prepare }
