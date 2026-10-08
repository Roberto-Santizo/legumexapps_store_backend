/** Read-only import contract. Parsers are adapted here; business validation never
 * selects a parser or reads ZIP/XML. ExcelJS also implements this structural API.
 */
export interface ParsedCell { value: unknown }
export interface ParsedRow {
    getCell(column: number | string): ParsedCell
    eachCell(callback: (cell: ParsedCell, column: number) => void): void
    eachCell(options: { includeEmpty: boolean }, callback: (cell: ParsedCell, column: number) => void): void
}
export interface ParsedWorksheet {
    name: string
    rowCount: number
    columnCount: number
    getRow(row: number): ParsedRow
    getColumn(column: number | string): { letter: string }
}
export interface ParsedWorkbook {
    worksheets: ParsedWorksheet[]
    getWorksheet(name: string): ParsedWorksheet | undefined
}

export type ParsedDataValue = string | number | boolean | Date | null | { formula: string; result?: string | number | boolean | Date } | { error: string }
export interface ParsedSheetData { name: string; rowCount: number; cells: { row: number; column: number; value: ParsedDataValue }[] }
export interface ParsedWorkbookData { sheets: ParsedSheetData[] }
