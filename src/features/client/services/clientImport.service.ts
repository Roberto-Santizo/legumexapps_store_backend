import type { ParsedWorkbook } from "../../../shared/utils/parsedWorkbook"
import ExcelJS from "exceljs"
import sequelize from "../../../database/connection"
import Client from "../models/Client.model"
import { createClientSchema, CreateClientInput } from "../schemas/client.schema"
import { AppError, BulkImportError, RowIssue } from "../../../shared/errors/AppError"
import { isImportRowBlank, loadWorkbookFromBuffer, mapImportHeaders, readImportCell, writeWorkbookToBuffer } from "../../../shared/utils/excelImport.util"
import { CLIENT_IMPORT_COLUMNS, MAX_CLIENT_IMPORT_ROWS, REQUIRED_CLIENT_IMPORT_FIELDS } from "../constants/clientImport.constant"

async function bulkImportClients(buffer: Buffer): Promise<Client[]> {
    let workbook: ParsedWorkbook
    try { workbook = await loadWorkbookFromBuffer(buffer) }
    catch { throw new AppError(422, "errors.client_import_invalid_workbook") }
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) throw new AppError(422, "errors.bulk_import_empty_file")

    const columns = mapImportHeaders(sheet.getRow(1), CLIENT_IMPORT_COLUMNS)
    const missingFields = REQUIRED_CLIENT_IMPORT_FIELDS.filter(field => !columns.has(field))
    if (missingFields.length > 0) {
        throw new AppError(422, "errors.bulk_import_missing_columns", {
            columns: missingFields.map(field => CLIENT_IMPORT_COLUMNS[field].header).join(", "),
        })
    }
    if (sheet.rowCount - 1 > MAX_CLIENT_IMPORT_ROWS) {
        throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_CLIENT_IMPORT_ROWS })
    }

    const rowIssues: RowIssue[] = []
    const candidates: CreateClientInput[] = []
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        if (isImportRowBlank(row, columns)) continue
        const result = createClientSchema.safeParse({ name: readImportCell(row, columns.get("name")) })
        if (result.success) {
            candidates.push(result.data)
        } else {
            for (const issue of result.error.issues) {
                rowIssues.push({
                    row: rowNumber,
                    field: issue.path.join(".") || "row",
                    key: `errors.client_import_name_${issue.code}`,
                    params: { defaultValue: issue.message },
                })
            }
        }
    }
    if (rowIssues.length > 0) throw new BulkImportError(rowIssues)
    if (candidates.length === 0) throw new AppError(422, "errors.bulk_import_empty_file")

    // Manual Client CRUD has no name uniqueness rule: repeated names create separate clients.
    return sequelize.transaction(async transaction => Client.bulkCreate(candidates, { transaction }))
}

async function buildClientImportTemplate(instructions: string[] = []): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Clientes")
    sheet.columns = [{ header: CLIENT_IMPORT_COLUMNS.name.header, key: "name", width: 40 }]
    sheet.getColumn("name").numFmt = "@"
    sheet.getRow(1).font = { bold: true }
    sheet.addRow({ name: "ACME" })

    const helpSheet = workbook.addWorksheet("Instrucciones")
    helpSheet.columns = [{ header: "Instrucciones", key: "help", width: 110 }]
    helpSheet.getRow(1).font = { bold: true }
    const lines = instructions.length ? instructions : [
        'Una fila por cliente. "Nombre" es obligatorio (1–100 caracteres). Correo y teléfono no existen en el catálogo actual.',
        "Solo CREA clientes nuevos; nunca actualiza. Los nombres repetidos están permitidos, igual que en el formulario manual.",
        "Una fila inválida cancela todo el archivo. Máximo 1000 filas y 5 MiB; las filas vacías se ignoran. Reemplace o elimine el ejemplo antes de importar.",
    ]
    lines.forEach(help => helpSheet.addRow({ help }))
    return writeWorkbookToBuffer(workbook)
}

export const clientImportService = { bulkImportClients, buildClientImportTemplate }
