import ExcelJS from "exceljs"
import JSZip from "jszip"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { loadWorkbookFromBuffer, writeWorkbookToBuffer } from "./excelImport.util"
import { prefixSpreadsheetNamespaces } from "../test-utils/xlsxCompatibility.fixture"
import { readImportCell } from "./excelImport.util"

async function fixture(names = ["Productos"]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    for (const name of names) workbook.addWorksheet(name).addRow(["SKU", "TEST-1"])
    return writeWorkbookToBuffer(workbook)
}

describe("loadWorkbookFromBuffer", () => {
    it("recovers the actual 20007-byte failing user workbook, with default content types", async () => {
        const buffer = await readFile(join(__dirname, "../test-utils/fixtures/carga_masiva_PRODUCTOS_VARIANTES_EMPAQUES_exceljs_FINAL.xlsx"))
        expect(buffer.length).toBe(20007)
        await expect(new ExcelJS.Workbook().xlsx.load(buffer as never)).rejects.toThrow("Cannot read properties of undefined (reading 'sheets')")
        const workbook = await loadWorkbookFromBuffer(buffer)
        expect(workbook.worksheets.map(sheet => [sheet.name, sheet.rowCount, sheet.columnCount])).toEqual([
            ["Productos y Variantes", 76, 14], ["Materiales de Empaque", 1001, 7], ["INSTRUCCIONES", 22, 1],
        ])
        const reference = JSON.parse(await readFile(join(__dirname, "../test-utils/fixtures/real-workbook-data-reference.json"), "utf8")) as { name: string; cells: number; sha256: string }[]
        for (const sheet of workbook.worksheets) {
            const cells: { row: number; column: number; type: string; value: unknown }[] = []
            sheet.eachRow((row, rowNumber) => row.eachCell((cell, column) => {
                const value = cell.value
                if (value === null || value === undefined) return
                const formula = typeof value === "object" && "formula" in value ? value.formula : undefined
                const kind = formula !== undefined ? "formula" : value instanceof Date ? "date" : typeof value
                cells.push({ row: rowNumber, column, type: kind, value: formula ?? (value instanceof Date ? value.toISOString() : value) })
            }))
            expect({ name: sheet.name, cells: cells.length, sha256: createHash("sha256").update(JSON.stringify(cells)).digest("hex") }).toEqual(reference.find(item => item.name === sheet.name))
        }
        for (const sheet of workbook.worksheets) {
            sheet.eachRow(row => row.eachCell((_cell, column) => {
                const value = readImportCell(row, column)
                expect(value).not.toBe("[object Object]")
                expect(value === null || typeof value === "string" || typeof value === "number").toBe(true)
            }))
        }
    })
    it("reads a saved independent openpyxl/ElementTree fixture that fails in ExcelJS", async () => {
        const buffer = await readFile(join(__dirname, "../test-utils/fixtures/openpyxl-namespaced.xlsx"))
        await expect(new ExcelJS.Workbook().xlsx.load(buffer as never)).rejects.toThrow("Cannot read properties of undefined (reading 'sheets')")
        const workbook = await loadWorkbookFromBuffer(buffer)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Productos y Variantes", "Materiales de Empaque", "INSTRUCCIONES"])
        expect(workbook.worksheets[0].getCell("A2").value).toBe("AB-816")
        expect(workbook.worksheets[0].getCell("C2").value).toBe(12.5)
        expect(workbook.worksheets[1].getCell("C2").value).toBe("CAJA")
        expect(workbook.worksheets[2].getCell("B2").value).toBe(false)
        expect(workbook.worksheets[2].getCell("C2").value).toHaveProperty("formula")
    })
    it.each([["Productos"], ["Productos y Variantes", "Materiales de Empaque", "INSTRUCCIONES"]])("reads actual XLSX sheets (%j)", async (...names) => {
        const workbook = await loadWorkbookFromBuffer(await fixture(names))
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(names)
        expect(workbook.worksheets[0].getCell("B1").value).toBe("TEST-1")
    })

    it("keeps ExcelJS as the primary parser for standard files", async () => {
        const buffer = await fixture()
        const load = jest.spyOn(ExcelJS.Workbook.prototype, "addWorksheet")
        try {
            const workbook = await loadWorkbookFromBuffer(buffer)
            expect(workbook.worksheets[0].getCell("B1").value).toBe("TEST-1")
            // ExcelJS loads its own model; only the fallback constructs sheets with addWorksheet.
            expect(load).not.toHaveBeenCalled()
        } finally { load.mockRestore() }
    })

    it("recovers prefixed workbook XML and worksheets after the exact sheets TypeError", async () => {
        const names = ["Productos y Variantes", "Materiales de Empaque", "INSTRUCCIONES"]
        const buffer = await prefixSpreadsheetNamespaces(await fixture(names), "workbook")
        await expect(new ExcelJS.Workbook().xlsx.load(buffer as never)).rejects.toThrow("Cannot read properties of undefined (reading 'sheets')")
        const workbook = await loadWorkbookFromBuffer(buffer)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(names)
        expect(workbook.worksheets.map(sheet => sheet.getCell("B1").value)).toEqual(names.map(() => "TEST-1"))
    })

    it("normalizes shared rich text, inline strings, numbers, booleans, dates and sparse blanks", async () => {
        const original = new ExcelJS.Workbook()
        const sheet = original.addWorksheet("Datos")
        sheet.getCell("A1").value = { richText: [{ text: "Árbol " }, { text: "verde" }] }
        sheet.getCell("C2").value = 12.5
        sheet.getCell("D2").value = false
        const zip = await JSZip.loadAsync(await prefixSpreadsheetNamespaces(await writeWorkbookToBuffer(original)))
        let xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
        xml = xml.replace("</m:sheetData>", '<m:row r="3"><m:c r="A3" t="inlineStr"><m:is><m:r><m:t xml:space="preserve"> texto </m:t></m:r><m:r><m:t>real</m:t></m:r></m:is></m:c><m:c r="B3" t="d"><m:v>2026-10-06T00:00:00Z</m:v></m:c></m:row></m:sheetData>')
        zip.file("xl/worksheets/sheet1.xml", xml)
        const workbook = await loadWorkbookFromBuffer(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }))
        const recovered = workbook.worksheets[0]
        expect(readImportCell(recovered.getRow(1), 1)).toBe("Árbol verde")
        expect(readImportCell(recovered.getRow(2), 1)).toBeNull()
        expect(readImportCell(recovered.getRow(2), 3)).toBe(12.5)
        expect(readImportCell(recovered.getRow(2), 4)).toBe("false")
        expect(readImportCell(recovered.getRow(3), 1)).toBe(" texto real")
        expect(recovered.getCell("B3").value).toBeInstanceOf(Date)
        expect(readImportCell(recovered.getRow(3), 2)).toBeNull()
    })

    it("retains formulas, including shared followers, without evaluating cached results", async () => {
        const zip = await JSZip.loadAsync(await prefixSpreadsheetNamespaces(await fixture()))
        const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
        zip.file("xl/worksheets/sheet1.xml", xml.replace("</m:sheetData>", '<m:row r="2"><m:c r="A2"><m:f t="shared" si="0">1+1</m:f><m:v>2</m:v></m:c><m:c r="B2"><m:f t="shared" si="0"/><m:v>2</m:v></m:c></m:row></m:sheetData>'))
        const workbook = await loadWorkbookFromBuffer(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }))
        expect(workbook.worksheets[0].getCell("A2").value).toMatchObject({ formula: "1+1", result: 2 })
        expect(workbook.worksheets[0].getCell("B2").value).toHaveProperty("formula")
    })

    it("ignores unsupported visual metadata when the data parts can be read", async () => {
        const zip = await JSZip.loadAsync(await fixture())
        zip.file("xl/styles.xml", "broken style XML")
        const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
        await expect(new ExcelJS.Workbook().xlsx.load(buffer as never)).rejects.toThrow()
        expect((await loadWorkbookFromBuffer(buffer)).worksheets[0].getCell("B1").value).toBe("TEST-1")
    })

    it("rejects malformed/truncated XML rather than accepting a partial workbook", async () => {
        const zip = await JSZip.loadAsync(await prefixSpreadsheetNamespaces(await fixture()))
        const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
        zip.file("xl/worksheets/sheet1.xml", xml.replace("</m:worksheet>", ""))
        await expect(loadWorkbookFromBuffer(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ statusCode: 422, fallbackCause: expect.any(Error) })
    })

    it("rejects external worksheet relationships and DTDs", async () => {
        const zip = await JSZip.loadAsync(await prefixSpreadsheetNamespaces(await fixture()))
        const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string")
        zip.file("xl/_rels/workbook.xml.rels", rels.replace('Target="worksheets/sheet1.xml"', 'Target="https://example.invalid/file.xml" TargetMode="External"'))
        await expect(loadWorkbookFromBuffer(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ statusCode: 422 })
        zip.file("xl/_rels/workbook.xml.rels", rels)
        const xml = await zip.file("xl/workbook.xml")!.async("string")
        zip.file("xl/workbook.xml", xml.replace(/(<m:workbook)/, '<!DOCTYPE workbook SYSTEM "file:///etc/passwd">$1'))
        await expect(loadWorkbookFromBuffer(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ statusCode: 422 })
    })

    it("rejects zip bombs before primary parsing, including dishonest expanded sizes", async () => {
        const zip = await JSZip.loadAsync(await fixture())
        zip.file("bomb.txt", Buffer.alloc(17 * 1024 * 1024))
        const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
        const load = jest.spyOn(ExcelJS.Workbook.prototype, "addWorksheet")
        try { await expect(loadWorkbookFromBuffer(buffer)).rejects.toMatchObject({ statusCode: 422 }) }
        finally { load.mockRestore() }
        let cursor = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
        while (cursor >= 0 && cursor + 46 <= buffer.length && buffer.readUInt32LE(cursor) === 0x02014b50) {
            const nameLength = buffer.readUInt16LE(cursor + 28)
            if (buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString() === "bomb.txt") buffer.writeUInt32LE(1, cursor + 24)
            cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32)
        }
        await expect(loadWorkbookFromBuffer(buffer)).rejects.toMatchObject({ statusCode: 422 })
    })

    it("does not silently truncate sheets, rows or columns outside safety bounds", async () => {
        const zip = await JSZip.loadAsync(await prefixSpreadsheetNamespaces(await fixture()))
        const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
        for (const badCell of ['<m:row r="100001"><m:c r="A100001"><m:v>1</m:v></m:c></m:row>', '<m:row r="2"><m:c r="XFE2"><m:v>1</m:v></m:c></m:row>']) {
            zip.file("xl/worksheets/sheet1.xml", xml.replace("</m:sheetData>", `${badCell}</m:sheetData>`))
            await expect(loadWorkbookFromBuffer(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ statusCode: 422 })
        }
    })

    it.each([undefined, null, "file.xlsx", {}, new ArrayBuffer(8), Buffer.alloc(0), Buffer.from("not XLSX")])("rejects invalid input %p", async value => {
        await expect(loadWorkbookFromBuffer(value as Buffer)).rejects.toMatchObject({ statusCode: 422, key: "errors.bulk_import_invalid_xlsx" })
    })

    it("rejects oversized buffers before ZIP parsing", async () => {
        await expect(loadWorkbookFromBuffer(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ statusCode: 422, key: "errors.bulk_import_file_too_large" })
    })

    it("converts a broken ZIP with a PK signature into an import error", async () => {
        await expect(loadWorkbookFromBuffer(Buffer.from("PK\x03\x04broken zip"))).rejects.toMatchObject({ statusCode: 422, key: "errors.bulk_import_unreadable_xlsx", cause: expect.any(Error) })
    })

    it("retains the exact ExcelJS sheets exception as internal cause", async () => {
        const zip = await JSZip.loadAsync(await fixture())
        zip.file("xl/workbook.xml", "")
        const buffer = await zip.generateAsync({ type: "nodebuffer" })
        await expect(new ExcelJS.Workbook().xlsx.load(buffer as never)).rejects.toThrow("Cannot read properties of undefined (reading 'sheets')")
        await expect(loadWorkbookFromBuffer(buffer)).rejects.toMatchObject({
            statusCode: 422, key: "errors.bulk_import_unreadable_xlsx",
            cause: expect.objectContaining({ message: "Cannot read properties of undefined (reading 'sheets')" }),
        })
    })

    it.each(["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"])("rejects an incomplete XLSX missing %s", async entry => {
        const zip = await JSZip.loadAsync(await fixture())
        zip.remove(entry)
        await expect(loadWorkbookFromBuffer(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ statusCode: 422 })
    })
})
