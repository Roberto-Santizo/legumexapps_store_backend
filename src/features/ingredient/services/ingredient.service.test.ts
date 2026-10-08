import "reflect-metadata"
import ExcelJS from "exceljs"
import { Op } from "sequelize"

// Modelos mockeados, .xlsx reales armados en memoria y unitService.findOrCreatePoundUnit mockeado.
jest.mock("../models/Ingredient.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() }
}))
jest.mock("../models/IngredientTranslation.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn() }
}))
jest.mock("../../unit/services/unit.service", () => ({
    __esModule: true,
    unitService: { findOrCreatePoundUnit: jest.fn() }
}))

import Ingredient from "../models/Ingredient.model"
import IngredientTranslation from "../models/IngredientTranslation.model"
import { unitService } from "../../unit/services/unit.service"
import { ingredientService } from "./ingredient.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockBulkCreate = Ingredient.bulkCreate as unknown as jest.Mock
const mockFindOne = Ingredient.findOne as unknown as jest.Mock
const mockFindAll = Ingredient.findAll as unknown as jest.Mock
const mockCreate = Ingredient.create as unknown as jest.Mock
const mockTranslationBulkCreate = IngredientTranslation.bulkCreate as unknown as jest.Mock
const mockFindOrCreatePoundUnit = unitService.findOrCreatePoundUnit as unknown as jest.Mock

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

const HEADERS = ["Código", "Nombre", "Costo por libra", "Nombre (inglés)"]
const POUND_UNIT = { id: 2, displayName: "Libra" }

function resetImportMocks(): void {
    mockFindOrCreatePoundUnit.mockReset()
    mockFindOrCreatePoundUnit.mockResolvedValue(POUND_UNIT)
    mockFindOne.mockReset()
    mockFindOne.mockResolvedValue(null)
    mockFindAll.mockReset()
    mockFindAll.mockResolvedValue([])
    mockBulkCreate.mockReset()
    mockBulkCreate.mockImplementation((rows: unknown[]) =>
        Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) })))
    )
    mockTranslationBulkCreate.mockReset()
    mockTranslationBulkCreate.mockResolvedValue([])
}

describe("ingredientService.bulkImportIngredients", () => {
    beforeEach(resetImportMocks)

    it("importa filas válidas forzando costUnitId a la Libra (una sola resolución por archivo)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "SAL-001", "Nombre": "Sal", "Costo por libra": 0.5 },
            { "Código": "AZU-001", "Nombre": "Azúcar", "Costo por libra": 0.75 },
        ])

        const result = await ingredientService.bulkImportIngredients(buffer)

        expect(result).toHaveLength(2)
        expect(mockFindOrCreatePoundUnit).toHaveBeenCalledTimes(1)
        expect(mockBulkCreate).toHaveBeenCalledWith(
            [
                expect.objectContaining({ code: "SAL-001", displayName: "Sal", costPerUnit: 0.5, costUnitId: POUND_UNIT.id, urlSlug: "sal" }),
                expect.objectContaining({ code: "AZU-001", displayName: "Azúcar", costPerUnit: 0.75, costUnitId: POUND_UNIT.id }),
            ],
            { returning: true }
        )
    })

    it("crea la traducción al inglés solo para las filas que la traen", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "SAL-001", "Nombre": "Sal", "Costo por libra": 0.5, "Nombre (inglés)": "Salt" },
            { "Código": "AZU-001", "Nombre": "Azúcar", "Costo por libra": 0.75 },
        ])

        await ingredientService.bulkImportIngredients(buffer)

        expect(mockTranslationBulkCreate).toHaveBeenCalledWith([{ ingredientId: 1, language: "en", displayName: "Salt" }])
    })

    it("acepta un código numérico (Excel lo entrega como number)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [{ "Código": 7, "Nombre": "Sal", "Costo por libra": 0.5 }])

        await ingredientService.bulkImportIngredients(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith([expect.objectContaining({ code: "7" })], { returning: true })
    })

    it("no crea NADA si una sola fila falla validación (todo o nada)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "SAL-001", "Nombre": "Sal", "Costo por libra": 0.5 },
            { "Código": "AZU-001", "Nombre": "Azúcar" }, // sin costo
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un código duplicado dentro del mismo archivo (sin distinguir mayúsculas)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "SAL-001", "Nombre": "Sal", "Costo por libra": 0.5 },
            { "Código": "sal-001", "Nombre": "Sal gruesa", "Costo por libra": 0.6 },
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 3, field: "code", key: "errors.bulk_import_duplicate_code_in_file" })]
        })
    })

    it("rechaza un nombre duplicado dentro del mismo archivo", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "SAL-001", "Nombre": "Sal", "Costo por libra": 0.5 },
            { "Código": "SAL-002", "Nombre": "SAL", "Costo por libra": 0.6 },
        ])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 3, field: "displayName", key: "errors.bulk_import_duplicate_name_in_file" })]
        })
    })

    it("rechaza un código que ya existe en la BD", async () => {
        mockFindAll.mockResolvedValue([{ code: "SAL-001" }])
        const buffer = await buildWorkbookBuffer(HEADERS, [{ "Código": "SAL-001", "Nombre": "Sal", "Costo por libra": 0.5 }])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 2, key: "errors.ingredient_code_already_exists" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("genera slugs únicos entre filas del mismo archivo y la BD", async () => {
        mockFindOne.mockImplementation(({ where }: { where: { urlSlug?: string } }) =>
            Promise.resolve(where.urlSlug === "sal" ? { id: 99 } : null)
        )
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "SAL-001", "Nombre": "Sal", "Costo por libra": 0.5 },
        ])

        await ingredientService.bulkImportIngredients(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith([expect.objectContaining({ urlSlug: "sal-2" })], { returning: true })
    })

    it("rechaza el archivo si le falta una columna requerida", async () => {
        const buffer = await buildWorkbookBuffer(["Código", "Nombre"], [{ "Código": "SAL-001", "Nombre": "Sal" }])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({
            statusCode: 422,
            key: "errors.bulk_import_missing_columns",
            params: { columns: "Costo por libra" }
        })
    })

    it("rechaza un archivo sin filas de datos", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [])

        await expect(ingredientService.bulkImportIngredients(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
    })
})

describe("ingredientService.buildIngredientImportTemplate", () => {
    beforeEach(resetImportMocks)

    it("genera un .xlsx cuyas filas de ejemplo pasan la validación real del importador (round-trip)", async () => {
        const templateBuffer = await ingredientService.buildIngredientImportTemplate()

        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo choque de tipos de exceljs documentado en shared/utils/excelImport.util.ts
        await workbook.xlsx.load(templateBuffer as any)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Ingredientes", "Instrucciones"])
        expect((workbook.worksheets[0].getRow(1).values as unknown[]).slice(1)).toEqual(HEADERS)

        const result = await ingredientService.bulkImportIngredients(templateBuffer)
        expect(result.length).toBe(3)
    })
})

const BASE_CREATE_INPUT = { code: "SAL-001", displayName: "Sal", costPerUnit: 0.5 }

describe("ingredientService.createIngredient", () => {
    beforeEach(() => {
        mockFindOne.mockReset()
        mockCreate.mockReset()
        mockFindOrCreatePoundUnit.mockReset()
        mockFindOrCreatePoundUnit.mockResolvedValue(POUND_UNIT)
    })

    it("rechaza un código ya existente sin llegar a Ingredient.create", async () => {
        mockFindOne.mockResolvedValueOnce({ id: 5, code: "SAL-001" })

        await expect(ingredientService.createIngredient(BASE_CREATE_INPUT)).rejects.toMatchObject({
            statusCode: 409,
            key: "errors.ingredient_code_already_exists",
            params: { code: "SAL-001" },
        })
        expect(mockCreate).not.toHaveBeenCalled()
        expect(mockFindOrCreatePoundUnit).not.toHaveBeenCalled()
    })

    it("crea el ingrediente forzando costUnitId a la Libra", async () => {
        mockFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("code" in where) return Promise.resolve(null)
            if ("urlSlug" in where) return Promise.resolve(null)
            return Promise.resolve({ id: 1, ...BASE_CREATE_INPUT, urlSlug: "sal", translations: [] })
        })
        mockCreate.mockResolvedValue({ id: 1 })

        const result = await ingredientService.createIngredient(BASE_CREATE_INPUT)

        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ code: "SAL-001", urlSlug: "sal", costUnitId: POUND_UNIT.id }))
        expect(result.code).toBe("SAL-001")
    })
})

describe("ingredientService.updateIngredient", () => {
    beforeEach(() => {
        mockFindOne.mockReset()
        mockFindOrCreatePoundUnit.mockReset()
        mockFindOrCreatePoundUnit.mockResolvedValue(POUND_UNIT)
    })

    it("rechaza un código que ya usa OTRO ingrediente, excluyendo el propio id", async () => {
        const mockUpdate = jest.fn()
        mockFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("id" in where && !("code" in where)) return Promise.resolve({ id: 1, code: "OLD-001", update: mockUpdate })
            if ("code" in where) return Promise.resolve({ id: 2, code: "NEW-001" })
            return Promise.resolve(null)
        })

        await expect(ingredientService.updateIngredient(1, { code: "NEW-001", costPerUnit: 1 })).rejects.toMatchObject({
            statusCode: 409,
            key: "errors.ingredient_code_already_exists"
        })
        expect(mockFindOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ code: "NEW-001", id: { [Op.ne]: 1 } }) })
        )
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it("actualiza forzando costUnitId a la Libra", async () => {
        const mockUpdate = jest.fn().mockResolvedValue(undefined)
        mockFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("id" in where && !("code" in where)) return Promise.resolve({ id: 1, code: "SAL-001", update: mockUpdate, translations: [] })
            return Promise.resolve(null)
        })

        await ingredientService.updateIngredient(1, { code: "SAL-001", costPerUnit: 0.6 })

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ costPerUnit: 0.6, costUnitId: POUND_UNIT.id }))
    })
})
