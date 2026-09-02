import "reflect-metadata"
import ExcelJS from "exceljs"

// Mock manual del modelo: solo se usa Packaging.bulkCreate en bulkImportPackagings -- el resto
// de la lógica (leer el .xlsx, mapear encabezados, validar cada fila contra createPackagingSchema)
// corre real, con archivos .xlsx armados de verdad en cada test (no hay atajo honesto para
// probar un parser de Excel sin un Excel real). Mismo patrón de mock manual que quote.service.test.ts.
jest.mock("../models/Packaging.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn() }
}))

import Packaging from "../models/Packaging.model"
import { packagingService } from "./packaging.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockBulkCreate = Packaging.bulkCreate as unknown as jest.Mock

type SheetRow = Record<string, string | number | undefined>

// Arma un .xlsx real en memoria con los encabezados y filas dadas -- así el test ejercita el
// parser de verdad (ExcelJS + el mapeo de encabezados/roles) en vez de mockear la lectura del
// archivo, que es justo la parte más riesgosa de esta función.
async function buildWorkbookBuffer(headers: string[], rows: SheetRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Empaques")
    sheet.addRow(headers)
    for (const row of rows) {
        sheet.addRow(headers.map(header => row[header]))
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer()
    return arrayBuffer as unknown as Buffer
}

const HEADERS = ["Nombre", "Rol del material", "Material", "Costo por unidad (Q)"]

describe("packagingService.bulkImportPackagings", () => {
    beforeEach(() => {
        mockBulkCreate.mockReset()
        mockBulkCreate.mockImplementation((rows: unknown[]) => Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) }))))
    })

    it("importa todas las filas válidas de un archivo bien formado (los 3 roles)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Bolsa plástica 2kg", "Rol del material": "Empaque individual", "Material": "Polietileno", "Costo por unidad (Q)": 1.25 },
            { "Nombre": "Bolsa grande 50u", "Rol del material": "Empaque intermedio (bolsa grande)", "Material": "Polipropileno", "Costo por unidad (Q)": 3.5 },
            { "Nombre": "Caja corrugada master", "Rol del material": "Material de paletización", "Material": "Cartón", "Costo por unidad (Q)": 2 },
        ])

        const result = await packagingService.bulkImportPackagings(buffer)

        expect(result).toHaveLength(3)
        expect(mockBulkCreate).toHaveBeenCalledWith([
            { displayName: "Bolsa plástica 2kg", packagingRole: "unit", packagingMaterial: "Polietileno", unitCost: 1.25 },
            { displayName: "Bolsa grande 50u", packagingRole: "intermediate", packagingMaterial: "Polipropileno", unitCost: 3.5 },
            { displayName: "Caja corrugada master", packagingRole: "pallet", packagingMaterial: "Cartón", unitCost: 2 },
        ])
    })

    it("acepta la key interna en inglés como alternativa al label en español (\"pallet\" en vez de \"Material de paletización\")", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Parales", "Rol del material": "pallet", "Costo por unidad (Q)": 1 },
        ])

        const result = await packagingService.bulkImportPackagings(buffer)

        expect(result).toHaveLength(1)
    })

    it("tolera variaciones de encabezado (mayúsculas, alias corto \"Rol\", sin acentos) sin perder columnas", async () => {
        const buffer = await buildWorkbookBuffer(["NOMBRE", "rol", "costo por unidad"], [
            { "NOMBRE": "Bolsa test", "rol": "unit", "costo por unidad": 5 },
        ])

        const result = await packagingService.bulkImportPackagings(buffer)

        expect(result).toHaveLength(1)
        expect(mockBulkCreate).toHaveBeenCalledWith([
            { displayName: "Bolsa test", packagingRole: "unit", packagingMaterial: undefined, unitCost: 5 },
        ])
    })

    it("no crea NADA si una sola fila falla validación (todo o nada) -- rechaza con BulkImportError", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Bolsa buena", "Rol del material": "unit", "Costo por unidad (Q)": 1 },
            { "Nombre": "Bolsa sin costo", "Rol del material": "unit" }, // unitCost requerido, ver createPackagingSchema
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("reporta el número de fila correcto (1-based, contando el encabezado) en el error", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Bolsa buena", "Rol del material": "unit", "Costo por unidad (Q)": 1 },
            { "Nombre": "Bolsa mala", "Rol del material": "unit" }, // fila 3 del archivo (1=encabezado, 2=buena, 3=mala)
        ])

        try {
            await packagingService.bulkImportPackagings(buffer)
            throw new Error("debía rechazar")
        } catch (error) {
            expect(error).toBeInstanceOf(BulkImportError)
            expect((error as BulkImportError).rowIssues.some(issue => issue.row === 3 && issue.field === "unitCost")).toBe(true)
        }
    })

    it("rechaza un rol que no coincide con ningún valor permitido, con un mensaje que lista los valores válidos", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Bolsa rara", "Rol del material": "paletizacion mal escrito", "Costo por unidad (Q)": 1 },
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "packagingRole", key: "errors.bulk_import_unknown_role" })]
        })
    })

    it("rechaza un nombre duplicado dentro del MISMO archivo (pegado dos veces por error)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Bolsa repetida", "Rol del material": "unit", "Costo por unidad (Q)": 1 },
            { "Nombre": "bolsa repetida", "Rol del material": "unit", "Costo por unidad (Q)": 2 }, // mismo nombre, distinto case
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "displayName", key: "errors.bulk_import_duplicate_name_in_file" })]
        })
    })

    it("ignora filas completamente vacías (huecos que deja Excel) sin tratarlas como error", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Bolsa buena", "Rol del material": "unit", "Costo por unidad (Q)": 1 },
            {},
        ])

        const result = await packagingService.bulkImportPackagings(buffer)

        expect(result).toHaveLength(1)
    })

    it("rechaza el archivo si le falta una columna requerida (ej. no trae \"Costo por unidad\")", async () => {
        const buffer = await buildWorkbookBuffer(["Nombre", "Rol del material"], [
            { "Nombre": "Bolsa", "Rol del material": "unit" },
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_missing_columns" })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un archivo sin filas de datos (solo encabezado)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
    })

    it("no confía en el costo mandado como texto con espacios -- lo convierte a número antes de validar", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Bolsa", "Rol del material": "unit", "Costo por unidad (Q)": "2.50" },
        ])

        const result = await packagingService.bulkImportPackagings(buffer)

        expect(result).toHaveLength(1)
        expect(mockBulkCreate).toHaveBeenCalledWith([
            expect.objectContaining({ unitCost: 2.5 })
        ])
    })
})

describe("packagingService.buildPackagingImportTemplate", () => {
    it("genera un .xlsx válido que bulkImportPackagings puede releer sin errores (round-trip)", async () => {
        const templateBuffer = await packagingService.buildPackagingImportTemplate()

        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo choque de tipos de exceljs documentado en packaging.service.ts
        await workbook.xlsx.load(templateBuffer as any)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Empaques", "Valores permitidos"])

        // Las filas de ejemplo de la plantilla deben, a su vez, pasar la validación real del
        // importador -- si algún día se desalinean los ejemplos con el schema, este test lo agarra.
        const result = await packagingService.bulkImportPackagings(templateBuffer)
        expect(result.length).toBeGreaterThan(0)
    })
})
