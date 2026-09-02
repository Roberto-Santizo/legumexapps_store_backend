import "reflect-metadata"
import ExcelJS from "exceljs"

// Mock manual de los 3 modelos que toca bulkImportIngredients -- el resto (leer el .xlsx, mapear
// encabezados, resolver tipo/unidad/booleanos, generar slug) corre real, con archivos .xlsx
// armados de verdad en cada test. Mismo patrón que packaging.service.test.ts.
jest.mock("../models/Ingredient.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn(), findOne: jest.fn() }
}))
jest.mock("../models/IngredientTranslation.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn() }
}))
jest.mock("../../unit/models/Unit.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn() }
}))

import Ingredient from "../models/Ingredient.model"
import IngredientTranslation from "../models/IngredientTranslation.model"
import Unit from "../../unit/models/Unit.model"
import { ingredientService } from "./ingredient.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockBulkCreate = Ingredient.bulkCreate as unknown as jest.Mock
const mockIngredientFindOne = Ingredient.findOne as unknown as jest.Mock
const mockTranslationBulkCreate = IngredientTranslation.bulkCreate as unknown as jest.Mock
const mockUnitFindAll = Unit.findAll as unknown as jest.Mock

type SheetRow = Record<string, string | number | undefined>

async function buildWorkbookBuffer(headers: string[], rows: SheetRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Ingredientes")
    sheet.addRow(headers)
    for (const row of rows) {
        sheet.addRow(headers.map(header => row[header]))
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer()
    return arrayBuffer as unknown as Buffer
}

const HEADERS = ["Nombre", "Tipo de ingrediente", "Es la variante orgánica (Sí/No)", "Se puede mezclar (Sí/No)", "Costo por unidad", "Unidad de costo", "Nombre (inglés)"]

const ACTIVE_UNITS = [
    { id: 1, displayName: "Kilogramo", isActive: true },
    { id: 2, displayName: "Libra", isActive: true },
]

describe("ingredientService.bulkImportIngredients", () => {
    beforeEach(() => {
        mockUnitFindAll.mockReset()
        mockUnitFindAll.mockResolvedValue(ACTIVE_UNITS)
        mockIngredientFindOne.mockReset()
        mockIngredientFindOne.mockResolvedValue(null) // ningún slug ya existe, por defecto
        mockBulkCreate.mockReset()
        mockBulkCreate.mockImplementation((rows: unknown[]) =>
            Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) })))
        )
        mockTranslationBulkCreate.mockReset()
        mockTranslationBulkCreate.mockResolvedValue([])
    })

    it("importa filas válidas resolviendo tipo y unidad de costo por nombre, con defaults de Sí/No aplicados", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta", "Costo por unidad": 20, "Unidad de costo": "Kilogramo" },
        ])

        const result = await ingredientService.bulkImportIngredients(buffer)

        expect(result).toHaveLength(1)
        expect(mockBulkCreate).toHaveBeenCalledWith(
            [expect.objectContaining({
                displayName: "Piña",
                ingredientType: "fruit",
                costPerUnit: 20,
                costUnitId: 1,
                isOrganic: false, // default (celda vacía)
                isMixable: true, // default (celda vacía)
            })],
            { returning: true }
        )
    })

    it("acepta la key interna en inglés para el tipo (\"fruit\" en vez de \"Fruta\")", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "fruit", "Costo por unidad": 20, "Unidad de costo": "kilogramo" },
        ])

        const result = await ingredientService.bulkImportIngredients(buffer)

        expect(result).toHaveLength(1)
    })

    it("crea la traducción al inglés (segundo bulkCreate) solo para las filas que la traen, emparejando por el id real devuelto", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta", "Costo por unidad": 20, "Unidad de costo": "Kilogramo", "Nombre (inglés)": "Pineapple" },
            { "Nombre": "Mango", "Tipo de ingrediente": "Fruta", "Costo por unidad": 15, "Unidad de costo": "Kilogramo" },
        ])

        await ingredientService.bulkImportIngredients(buffer)

        expect(mockTranslationBulkCreate).toHaveBeenCalledWith([
            { ingredientId: 1, language: "en", displayName: "Pineapple" }
        ])
    })

    it("no crea NADA si una sola fila falla validación (todo o nada)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta", "Costo por unidad": 20, "Unidad de costo": "Kilogramo" },
            { "Nombre": "Sin costo", "Tipo de ingrediente": "Fruta", "Unidad de costo": "Kilogramo" }, // costPerUnit requerido
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockBulkCreate).not.toHaveBeenCalled()
        expect(mockTranslationBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un tipo de ingrediente desconocido, listando los valores válidos", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Lácteo", "Costo por unidad": 20, "Unidad de costo": "Kilogramo" },
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 2, field: "ingredientType", key: "errors.bulk_import_unknown_ingredient_type" })]
        })
    })

    it("rechaza una unidad de costo que no existe en el catálogo activo", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta", "Costo por unidad": 20, "Unidad de costo": "Tonelada Métrica Imaginaria" },
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "costUnitId", key: "errors.bulk_import_unit_not_found" })]
        })
    })

    it("rechaza una unidad de costo ambigua (dos unidades activas con el mismo nombre)", async () => {
        mockUnitFindAll.mockResolvedValue([
            { id: 1, displayName: "Kilogramo", isActive: true },
            { id: 5, displayName: "kilogramo", isActive: true }, // mismo nombre normalizado, fila distinta -- caso real permitido por el modelo
        ])
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta", "Costo por unidad": 20, "Unidad de costo": "Kilogramo" },
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "costUnitId", key: "errors.bulk_import_unit_ambiguous" })]
        })
    })

    it("rechaza un valor de Sí/No no reconocido en vez de asumir uno", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta", "Es la variante orgánica (Sí/No)": "tal vez", "Costo por unidad": 20, "Unidad de costo": "Kilogramo" },
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "isOrganic", key: "errors.bulk_import_invalid_boolean" })]
        })
    })

    it("acepta variantes de Sí/No (true/false/1/0/x) sin distinguir mayúsculas", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta", "Es la variante orgánica (Sí/No)": "TRUE", "Se puede mezclar (Sí/No)": "0", "Costo por unidad": 20, "Unidad de costo": "Kilogramo" },
        ])

        await ingredientService.bulkImportIngredients(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith(
            [expect.objectContaining({ isOrganic: true, isMixable: false })],
            { returning: true }
        )
    })

    it("rechaza un nombre duplicado dentro del MISMO archivo", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta", "Costo por unidad": 20, "Unidad de costo": "Kilogramo" },
            { "Nombre": "piña", "Tipo de ingrediente": "Fruta", "Costo por unidad": 22, "Unidad de costo": "Kilogramo" },
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "displayName", key: "errors.bulk_import_duplicate_name_in_file" })]
        })
    })

    it("genera un slug único que evita tanto la BD como los slugs ya asignados en este mismo archivo", async () => {
        // Simula que "pina" ya existe en la BD -- el generador debe probar "pina-2" para la
        // primera fila, y luego "pina-3" para la segunda (nombre distinto pero mismo slug base).
        mockIngredientFindOne.mockImplementation(({ where }: { where: { urlSlug: string } }) =>
            Promise.resolve(where.urlSlug === "pina" ? { id: 999 } : null)
        )
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta", "Costo por unidad": 20, "Unidad de costo": "Kilogramo" },
            { "Nombre": "Piña!!", "Tipo de ingrediente": "Fruta", "Costo por unidad": 22, "Unidad de costo": "Kilogramo" },
        ])

        await ingredientService.bulkImportIngredients(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith(
            [
                expect.objectContaining({ urlSlug: "pina-2" }),
                expect.objectContaining({ urlSlug: "pina-3" }),
            ],
            { returning: true }
        )
    })

    it("rechaza el archivo si le falta una columna requerida", async () => {
        const buffer = await buildWorkbookBuffer(["Nombre", "Tipo de ingrediente"], [
            { "Nombre": "Piña", "Tipo de ingrediente": "Fruta" },
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_missing_columns" })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un archivo sin filas de datos", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
    })
})

describe("ingredientService.buildIngredientImportTemplate", () => {
    it("genera un .xlsx válido cuyas filas de ejemplo pasan la validación real del importador (round-trip)", async () => {
        mockUnitFindAll.mockResolvedValue(ACTIVE_UNITS)
        mockIngredientFindOne.mockResolvedValue(null)
        mockBulkCreate.mockImplementation((rows: unknown[]) =>
            Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) })))
        )
        mockTranslationBulkCreate.mockResolvedValue([])

        const templateBuffer = await ingredientService.buildIngredientImportTemplate()

        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo choque de tipos de exceljs documentado en shared/utils/excelImport.util.ts
        await workbook.xlsx.load(templateBuffer as any)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Ingredientes", "Valores permitidos"])

        const result = await ingredientService.bulkImportIngredients(templateBuffer)
        expect(result.length).toBeGreaterThan(0)
    })
})
