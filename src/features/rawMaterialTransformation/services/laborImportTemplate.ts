import ExcelJS from "exceljs"
import { addImportValidation, writeWorkbookToBuffer } from "../../../shared/utils/excelImport.util"
import { LABOR_IMPORT_COLUMNS, LABOR_IMPORT_SHEET } from "../constants/laborImport.constant"
import type { LaborImportLine } from "../constants/laborImport.constant"

export async function buildLaborImportTemplate(sourceLines: LaborImportLine[]) {
    const workbook = new ExcelJS.Workbook()
    workbook.title = "RR. HH. · Salario mensual y bono decreto"
    const sheet = workbook.addWorksheet(LABOR_IMPORT_SHEET, {
        views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
        properties: { defaultRowHeight: 32, tabColor: { argb: "173F35" } },
        pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" },
    })
    const widths = [22, 57, 35, 23, 23]
    sheet.columns = LABOR_IMPORT_COLUMNS.map((header, index) => ({ header, width: widths[index] }))
    sheet.getRow(1).height = 38
    sheet.getRow(1).eachCell(cell => {
        cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFF" } }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "173F35" } }
        cell.alignment = { vertical: "middle", wrapText: true }
    })
    sheet.getCell("D1").note = "Complete únicamente Salario Mensual y Bono Decreto en quetzales, como números con hasta 2 decimales. No sume prestaciones ni bono dentro del salario. Complete todas las posiciones de una línea; deje otras líneas vacías si todavía están pendientes."
    sheet.getCell("E1").note = "Ingrese el bono decreto separado del salario. Escriba 0 si no aplica. Un vacío no significa cero. El sistema calcula las prestaciones y los demás costos."
    const lines = sourceLines.filter(line => line.isActive).slice().sort((a, b) => a.displayName.localeCompare(b.displayName, "es", { numeric: true }) || a.code.localeCompare(b.code))
    for (const [lineIndex, line] of lines.entries()) {
        const positions = line.positions.slice().sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }))
        for (const [index, position] of positions.entries()) {
            const row = sheet.addRow([position.code, line.displayName, position.jobTitle, null, null])
            row.eachCell({ includeEmpty: true }, (cell, column) => {
                const editable = column >= 4
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: editable ? "FFF2CC" : lineIndex % 2 ? "E8EFEC" : "F0F3F5" } }
                cell.font = { name: "Calibri", size: 11, color: { argb: "182D29" } }
                cell.alignment = { vertical: "middle", wrapText: true, horizontal: editable ? "right" : "left" }
                cell.protection = { locked: !editable }
                cell.border = { bottom: { style: "hair", color: { argb: "DAE2DE" } }, ...(index === 0 ? { top: { style: "medium", color: { argb: "173F35" } } } : {}) }
            })
        }
    }
    for (const column of ["D", "E"]) {
        sheet.getColumn(column).numFmt = '"Q"#,##0.00'
        if (sheet.rowCount > 1) addImportValidation(sheet, `${column}2:${column}${sheet.rowCount}`, {
            type: "decimal", operator: "between", allowBlank: true, formulae: [0, 1000000],
            showErrorMessage: true, errorTitle: "Ingrese un monto en quetzales", error: "Use un número de 0 a 1000000 con máximo 2 decimales. Escriba 0 si no aplica.",
            showInputMessage: true, promptTitle: "Solo completar este importe", prompt: "Monto mensual en GTQ. El sistema calcula las prestaciones automáticamente.",
        })
    }
    sheet.autoFilter = { from: "A1", to: { row: sheet.rowCount, column: 5 } }
    sheet.headerFooter.oddFooter = "&LCompletar solo Salario Mensual y Bono Decreto · GTQ&RPágina &P de &N"
    await sheet.protect("", { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, spinCount: 1 })
    return writeWorkbookToBuffer(workbook)
}
