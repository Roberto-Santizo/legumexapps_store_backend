jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn() } }))
jest.mock("../models/Client.model", () => ({ __esModule: true, default: { bulkCreate: jest.fn(), findAll: jest.fn(), update: jest.fn() } }))

import ExcelJS from "exceljs"
import { prefixSpreadsheetNamespaces } from "../../../shared/test-utils/xlsxCompatibility.fixture"
import sequelize from "../../../database/connection"
import Client from "../models/Client.model"
import { clientImportService } from "./clientImport.service"
import { createClientSchema } from "../schemas/client.schema"
import { loadWorkbookFromBuffer, writeWorkbookToBuffer } from "../../../shared/utils/excelImport.util"

const transaction = { id: "import-transaction" }
const transactionMock = sequelize.transaction as jest.Mock
const bulkCreate = Client.bulkCreate as jest.Mock
async function file(rows: unknown[][], headers = ["Nombre"]) {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Clientes")
    sheet.addRow(headers)
    rows.forEach(row => sheet.addRow(row))
    return writeWorkbookToBuffer(workbook)
}
beforeEach(() => {
    jest.resetAllMocks()
    transactionMock.mockImplementation(async operation => operation(transaction))
    bulkCreate.mockImplementation(async rows => rows.map((row: object, index: number) => ({ id: index + 1, ...row })))
})

describe("client bulk import", () => {
    test("fallback preserves normalization, sparse blanks and the existing create schema", async () => {
        const result = await clientImportService.bulkImportClients(await prefixSpreadsheetNamespaces(await file([["  ACME  "], [], ["Cliente Ñ"]])))
        expect(result.map(row => row.name)).toEqual(["ACME", "Cliente Ñ"])
        expect(transactionMock).toHaveBeenCalledTimes(1)
    })
    test("imports all valid names using the same schema and one transaction", async () => {
        const names = ["  ACME  ", "Cliente Ñ", "A".repeat(100)]
        const result = await clientImportService.bulkImportClients(await file(names.map(name => [name])))
        expect(result).toHaveLength(3)
        expect(bulkCreate).toHaveBeenCalledWith(names.map(name => createClientSchema.parse({ name })), { transaction })
        expect(transactionMock).toHaveBeenCalledTimes(1)
    })
    test("allows names repeated in the file and DB, without reading or updating existing clients", async () => {
        jest.mocked(Client.findAll).mockResolvedValue([{ name: "ACME" }] as never)
        const result = await clientImportService.bulkImportClients(await file([["ACME"], ["ACME"], ["acme"]]))
        expect(result).toHaveLength(3)
        expect(Client.findAll).not.toHaveBeenCalled()
        expect(Client.update).not.toHaveBeenCalled()
    })
    test("collects every invalid row and creates nothing", async () => {
        const buffer = await file([["Valid"], ["   "], ["A".repeat(101)], [42]])
        await expect(clientImportService.bulkImportClients(buffer)).rejects.toMatchObject({ rowIssues: [
            { row: 3, field: "name", key: "errors.client_import_name_too_small" },
            { row: 4, field: "name", key: "errors.client_import_name_too_big" },
            { row: 5, field: "name", key: "errors.client_import_name_invalid_type" },
        ] })
        expect(bulkCreate).not.toHaveBeenCalled()
        expect(transactionMock).not.toHaveBeenCalled()
    })
    test("requires the name header", async () => {
        await expect(clientImportService.bulkImportClients(await file([["value"]], ["Other"]))).rejects.toMatchObject({ key: "errors.bulk_import_missing_columns", params: { columns: "Nombre" } })
        expect(bulkCreate).not.toHaveBeenCalled()
    })
    test("ignores blank rows, retaining Excel row numbers", async () => {
        await expect(clientImportService.bulkImportClients(await file([["Valid"], [], [" " ]]))).rejects.toMatchObject({ rowIssues: [expect.objectContaining({ row: 4, field: "name" })] })
        const result = await clientImportService.bulkImportClients(await file([["Valid"], [], ["Another"]]))
        expect(result).toHaveLength(2)
    })
    test("rejects empty and all-blank files", async () => {
        for (const rows of [[], [[]]]) {
            await expect(clientImportService.bulkImportClients(await file(rows))).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
        }
        expect(bulkCreate).not.toHaveBeenCalled()
    })
    test("rejects more than 1000 rows before writing", async () => {
        await expect(clientImportService.bulkImportClients(await file(Array.from({ length: 1001 }, () => ["Client"])))).rejects.toMatchObject({ key: "errors.bulk_import_too_many_rows" })
        expect(bulkCreate).not.toHaveBeenCalled()
    })
    test("accepts normalized and reordered name headers", async () => {
        const result = await clientImportService.bulkImportClients(await file([["ignored", "ACME"]], ["Other", " NÓMBRE "]))
        expect(result[0].name).toBe("ACME")
    })
    test("template round-trips with exactly the manual create fields", async () => {
        const buffer = await clientImportService.buildClientImportTemplate()
        const workbook = await loadWorkbookFromBuffer(buffer)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Clientes", "Instrucciones"])
        expect(workbook.worksheets[0].getRow(1).values).toEqual([undefined, "Nombre"])
        expect(Object.keys(createClientSchema.shape)).toEqual(["name"])
        expect(await clientImportService.bulkImportClients(buffer)).toHaveLength(1)
        workbook.worksheets[0].getCell("A2").value = "Real client"
        expect((await clientImportService.bulkImportClients(await writeWorkbookToBuffer(workbook)))[0].name).toBe("Real client")
    })
    test("propagates a failed DB insert out of the transaction without retrying", async () => {
        const failure = new Error("insert failed")
        bulkCreate.mockRejectedValue(failure)
        await expect(clientImportService.bulkImportClients(await file([["One"], ["Two"]]))).rejects.toBe(failure)
        expect(bulkCreate).toHaveBeenCalledTimes(1)
        expect(bulkCreate).toHaveBeenCalledWith([{ name: "One" }, { name: "Two" }], { transaction })
    })
    test("reports malformed Excel as a translated validation error without a transaction", async () => {
        await expect(clientImportService.bulkImportClients(Buffer.from("not Excel"))).rejects.toMatchObject({
            statusCode: 422, key: "errors.client_import_invalid_workbook",
        })
        expect(transactionMock).not.toHaveBeenCalled()
    })
    test("imports cached formulas and rich text through the existing shared reader", async () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet("Clientes")
        sheet.addRow(["Nombre"])
        sheet.addRow([{ formula: '"ACME"', result: "ACME" }])
        sheet.addRow([{ richText: [{ text: "Client " }, { text: "B" }] }])
        const result = await clientImportService.bulkImportClients(await writeWorkbookToBuffer(workbook))
        expect(result.map(row => row.name)).toEqual(["ACME", "Client B"])
    })
})
