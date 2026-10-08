import "reflect-metadata"
import ExcelJS from "exceljs"

// Mock manual del modelo; leer el .xlsx, mapear encabezados y validar cada fila corre real.
jest.mock("../models/Presentation.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn() }
}))

import Presentation from "../models/Presentation.model"
import { presentationService } from "./presentation.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockBulkCreate = Presentation.bulkCreate as unknown as jest.Mock

type SheetRow = Record<string, string | number | undefined>

async function buildWorkbookBuffer(headers: string[], rows: SheetRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Presentaciones")
    sheet.addRow(headers)
    for (const row of rows) {
        sheet.addRow(headers.map(header => row[header]))
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer()
    return arrayBuffer as unknown as Buffer
}

const HEADERS = ["Nombre", "Peso neto por unidad (g)"]

describe("presentationService.bulkImportPresentations", () => {
    beforeEach(() => {
        mockBulkCreate.mockReset()
        mockBulkCreate.mockImplementation((rows: unknown[]) => Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) }))))
    })

    it("importa todas las filas válidas de un archivo bien formado", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Botella 12 oz (0.75 lb)", "Peso neto por unidad (g)": 340.19 },
            { "Nombre": "Botella 976 ml", "Peso neto por unidad (g)": 976 },
        ])

        const result = await presentationService.bulkImportPresentations(buffer)

        expect(result).toHaveLength(2)
        expect(mockBulkCreate).toHaveBeenCalledWith([
            { displayLabel: "Botella 12 oz (0.75 lb)", netWeightGrams: 340.19 },
            { displayLabel: "Botella 976 ml", netWeightGrams: 976 },
        ])
    })

    it("no crea NADA si una sola fila falla validación (todo o nada)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Botella buena", "Peso neto por unidad (g)": 340.19 },
            { "Nombre": "Botella sin peso" }, // netWeightGrams requerido
        ])

        await expect(presentationService.bulkImportPresentations(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un nombre repetido dentro del MISMO archivo (posible fila pegada dos veces por error)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Botella 976 ml", "Peso neto por unidad (g)": 976 },
            { "Nombre": "botella 976 ml", "Peso neto por unidad (g)": 976 },
        ])

        await expect(presentationService.bulkImportPresentations(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "displayLabel", key: "errors.bulk_import_duplicate_name_in_file" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza el archivo si le falta la columna requerida de peso neto", async () => {
        const buffer = await buildWorkbookBuffer(["Nombre"], [{ "Nombre": "Botella" }])

        await expect(presentationService.bulkImportPresentations(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_missing_columns" })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un archivo sin filas de datos (solo encabezado)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [])

        await expect(presentationService.bulkImportPresentations(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
    })

    it("ignora filas completamente vacías sin tratarlas como error", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Botella 976 ml", "Peso neto por unidad (g)": 976 },
            {},
        ])

        const result = await presentationService.bulkImportPresentations(buffer)

        expect(result).toHaveLength(1)
    })
})

describe("presentationService.buildPresentationImportTemplate", () => {
    it("genera un .xlsx válido que bulkImportPresentations puede releer sin errores (round-trip)", async () => {
        mockBulkCreate.mockImplementation((rows: unknown[]) => Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) }))))

        const templateBuffer = await presentationService.buildPresentationImportTemplate()

        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo choque de tipos de exceljs documentado en presentation.service.ts
        await workbook.xlsx.load(templateBuffer as any)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Presentaciones", "Instrucciones"])

        const result = await presentationService.bulkImportPresentations(templateBuffer)
        expect(result.length).toBeGreaterThan(0)
    })
})
