import "reflect-metadata"
import ExcelJS from "exceljs"
import { Op } from "sequelize"

// Mock manual de los modelos que toca bulkImportRawMaterials -- el resto (leer el .xlsx, mapear
// encabezados, resolver tipo/booleanos, generar slug) corre real, con archivos .xlsx armados de
// verdad en cada test. Mismo patrón que packaging.service.test.ts. La unidad de costeo ya NO se
// resuelve por nombre desde el archivo -- se mockea unitService.findOrCreatePoundUnit en su lugar
// (ver rawMaterial.service.ts, force-to-pound).
jest.mock("../models/RawMaterial.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() }
}))
jest.mock("../models/RawMaterialTranslation.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn() }
}))
jest.mock("../../unit/services/unit.service", () => ({
    __esModule: true,
    unitService: { findOrCreatePoundUnit: jest.fn() }
}))

import RawMaterial from "../models/RawMaterial.model"
import RawMaterialTranslation from "../models/RawMaterialTranslation.model"
import { unitService } from "../../unit/services/unit.service"
import { rawMaterialService } from "./rawMaterial.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockBulkCreate = RawMaterial.bulkCreate as unknown as jest.Mock
const mockRawMaterialFindOne = RawMaterial.findOne as unknown as jest.Mock
const mockRawMaterialFindAll = RawMaterial.findAll as unknown as jest.Mock
const mockRawMaterialCreate = RawMaterial.create as unknown as jest.Mock
const mockTranslationBulkCreate = RawMaterialTranslation.bulkCreate as unknown as jest.Mock
const mockFindOrCreatePoundUnit = unitService.findOrCreatePoundUnit as unknown as jest.Mock

type SheetRow = Record<string, string | number | undefined>

async function buildWorkbookBuffer(headers: string[], rows: SheetRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Materias Primas")
    sheet.addRow(headers)
    for (const row of rows) {
        sheet.addRow(headers.map(header => row[header]))
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer()
    return arrayBuffer as unknown as Buffer
}

// "Código" primero a propósito, igual que la plantilla real -- pero el parser mapea por nombre
// de encabezado, no por posición, así que el orden acá no es lo que se está probando. Sin columna
// de "Unidad de costo" -- la unidad de costeo ya no es un dato de entrada (ver force-to-pound).
const HEADERS = ["Código", "Nombre", "Tipo de materia prima", "Es la variante orgánica (Sí/No)", "Se puede mezclar (Sí/No)", "Costo por libra", "Nombre (inglés)"]

const POUND_UNIT = { id: 2, displayName: "Libra" }

describe("rawMaterialService.bulkImportRawMaterials", () => {
    beforeEach(() => {
        mockFindOrCreatePoundUnit.mockReset()
        mockFindOrCreatePoundUnit.mockResolvedValue(POUND_UNIT)
        mockRawMaterialFindOne.mockReset()
        mockRawMaterialFindOne.mockResolvedValue(null) // ningún slug ya existe, por defecto
        mockRawMaterialFindAll.mockReset()
        mockRawMaterialFindAll.mockResolvedValue([]) // ningún código ya existe en la BD, por defecto
        mockBulkCreate.mockReset()
        mockBulkCreate.mockImplementation((rows: unknown[]) =>
            Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) })))
        )
        mockTranslationBulkCreate.mockReset()
        mockTranslationBulkCreate.mockResolvedValue([])
    })

    it("importa filas válidas resolviendo el tipo por nombre, con defaults de Sí/No aplicados, y fuerza costUnitId a la Libra", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 },
        ])

        const result = await rawMaterialService.bulkImportRawMaterials(buffer)

        expect(result).toHaveLength(1)
        expect(mockFindOrCreatePoundUnit).toHaveBeenCalledTimes(1)
        expect(mockBulkCreate).toHaveBeenCalledWith(
            [expect.objectContaining({
                code: "PIN-001",
                displayName: "Piña",
                ingredientType: "fruit",
                costPerUnit: 9.5,
                costUnitId: POUND_UNIT.id,
                isOrganic: false, // default (celda vacía)
                isMixable: true, // default (celda vacía)
            })],
            { returning: true }
        )
    })

    it("acepta la key interna en inglés para el tipo (\"fruit\" en vez de \"Fruta\")", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "fruit", "Costo por libra": 9.5 },
        ])

        const result = await rawMaterialService.bulkImportRawMaterials(buffer)

        expect(result).toHaveLength(1)
    })

    it("crea la traducción al inglés (segundo bulkCreate) solo para las filas que la traen, emparejando por el id real devuelto", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5, "Nombre (inglés)": "Pineapple" },
            { "Código": "MAN-001", "Nombre": "Mango", "Tipo de materia prima": "Fruta", "Costo por libra": 7 },
        ])

        await rawMaterialService.bulkImportRawMaterials(buffer)

        expect(mockTranslationBulkCreate).toHaveBeenCalledWith([
            { rawMaterialId: 1, language: "en", displayName: "Pineapple" }
        ])
    })

    it("no crea NADA si una sola fila falla validación (todo o nada)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 },
            { "Código": "SC-001", "Nombre": "Sin costo", "Tipo de materia prima": "Fruta" }, // costPerUnit requerido
        ])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockBulkCreate).not.toHaveBeenCalled()
        expect(mockTranslationBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un tipo de materia prima desconocido, listando los valores válidos", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Lácteo", "Costo por libra": 9.5 },
        ])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 2, field: "ingredientType", key: "errors.bulk_import_unknown_raw_material_type" })]
        })
    })

    it("rechaza un valor de Sí/No no reconocido en vez de asumir uno", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Es la variante orgánica (Sí/No)": "tal vez", "Costo por libra": 9.5 },
        ])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "isOrganic", key: "errors.bulk_import_invalid_boolean" })]
        })
    })

    it("acepta variantes de Sí/No (true/false/1/0/x) sin distinguir mayúsculas", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Es la variante orgánica (Sí/No)": "TRUE", "Se puede mezclar (Sí/No)": "0", "Costo por libra": 9.5 },
        ])

        await rawMaterialService.bulkImportRawMaterials(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith(
            [expect.objectContaining({ isOrganic: true, isMixable: false })],
            { returning: true }
        )
    })

    it("acepta un código sin formato de texto (Excel lo entrega como number, no debe romper la validación de string)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": 12345, "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 },
        ])

        await rawMaterialService.bulkImportRawMaterials(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith(
            [expect.objectContaining({ code: "12345" })],
            { returning: true }
        )
    })

    it("rechaza un nombre duplicado dentro del MISMO archivo", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 },
            { "Código": "PIN-002", "Nombre": "piña", "Tipo de materia prima": "Fruta", "Costo por libra": 10 },
        ])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "displayName", key: "errors.bulk_import_duplicate_name_in_file" })]
        })
    })

    it("rechaza un código duplicado dentro del MISMO archivo (sin distinguir mayúsculas)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 },
            { "Código": "pin-001", "Nombre": "Mango", "Tipo de materia prima": "Fruta", "Costo por libra": 10 },
        ])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 3, field: "code", key: "errors.bulk_import_duplicate_code_in_file" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un código que ya existe en la BD (activo o no)", async () => {
        mockRawMaterialFindAll.mockResolvedValue([{ code: "PIN-001" }])
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 },
        ])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "code", key: "errors.raw_material_code_already_exists" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza una fila con la celda de Código vacía (columna requerida) en vez de insertarla sin código", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 }, // sin "Código"
        ])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 2, field: "code" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza una fila con el Código de solo espacios en blanco", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "   ", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 },
        ])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 2, field: "code" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("genera un slug único que evita tanto la BD como los slugs ya asignados en este mismo archivo", async () => {
        // Simula que "pina" ya existe en la BD -- el generador debe probar "pina-2" para la
        // primera fila, y luego "pina-3" para la segunda (nombre distinto pero mismo slug base).
        mockRawMaterialFindOne.mockImplementation(({ where }: { where: { urlSlug: string } }) =>
            Promise.resolve(where.urlSlug === "pina" ? { id: 999 } : null)
        )
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 },
            { "Código": "PIN-002", "Nombre": "Piña!!", "Tipo de materia prima": "Fruta", "Costo por libra": 10 },
        ])

        await rawMaterialService.bulkImportRawMaterials(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith(
            [
                expect.objectContaining({ urlSlug: "pina-2" }),
                expect.objectContaining({ urlSlug: "pina-3" }),
            ],
            { returning: true }
        )
    })

    it("rechaza el archivo si le falta una columna requerida", async () => {
        const buffer = await buildWorkbookBuffer(["Nombre", "Tipo de materia prima"], [
            { "Nombre": "Piña", "Tipo de materia prima": "Fruta" },
        ])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_missing_columns" })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un archivo sin filas de datos", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [])

        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
    })
})

describe("rawMaterialService.buildRawMaterialImportTemplate", () => {
    it("genera un .xlsx válido cuyas filas de ejemplo pasan la validación real del importador (round-trip)", async () => {
        mockFindOrCreatePoundUnit.mockResolvedValue(POUND_UNIT)
        mockRawMaterialFindOne.mockResolvedValue(null)
        mockRawMaterialFindAll.mockResolvedValue([])
        mockBulkCreate.mockImplementation((rows: unknown[]) =>
            Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) })))
        )
        mockTranslationBulkCreate.mockResolvedValue([])

        const templateBuffer = await rawMaterialService.buildRawMaterialImportTemplate()

        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo choque de tipos de exceljs documentado en shared/utils/excelImport.util.ts
        await workbook.xlsx.load(templateBuffer as any)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Materias Primas", "Valores permitidos"])

        const result = await rawMaterialService.bulkImportRawMaterials(templateBuffer)
        expect(result.length).toBeGreaterThan(0)
    })
})

const BASE_CREATE_INPUT = {
    code: "PIN-001",
    displayName: "Piña",
    ingredientType: "fruit" as const,
    costPerUnit: 9.5,
}

describe("rawMaterialService.createRawMaterial", () => {
    beforeEach(() => {
        mockRawMaterialFindOne.mockReset()
        mockRawMaterialCreate.mockReset()
        mockFindOrCreatePoundUnit.mockReset()
        mockFindOrCreatePoundUnit.mockResolvedValue(POUND_UNIT)
    })

    it("rechaza crear una materia prima si el código ya existe (activo o no), sin llegar a RawMaterial.create", async () => {
        // Primer findOne (assertCodeIsUnique) encuentra una materia prima existente con ese código.
        mockRawMaterialFindOne.mockResolvedValueOnce({ id: 5, code: "PIN-001" })

        await expect(rawMaterialService.createRawMaterial(BASE_CREATE_INPUT)).rejects.toMatchObject({
            statusCode: 409,
            key: "errors.raw_material_code_already_exists",
            params: { code: "PIN-001" },
        })
        expect(mockRawMaterialCreate).not.toHaveBeenCalled()
        expect(mockFindOrCreatePoundUnit).not.toHaveBeenCalled()
    })

    it("crea la materia prima cuando el código no existe todavía, forzando costUnitId a la Libra resuelta por findOrCreatePoundUnit", async () => {
        mockRawMaterialFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("code" in where) return Promise.resolve(null) // código libre
            if ("urlSlug" in where) return Promise.resolve(null) // slug libre
            // getRawMaterialById final (where: { id, isActive: true })
            return Promise.resolve({ id: 1, ...BASE_CREATE_INPUT, urlSlug: "pina", translations: [] })
        })
        mockRawMaterialCreate.mockResolvedValue({ id: 1 })

        const result = await rawMaterialService.createRawMaterial(BASE_CREATE_INPUT)

        expect(mockFindOrCreatePoundUnit).toHaveBeenCalledTimes(1)
        expect(mockRawMaterialCreate).toHaveBeenCalledWith(expect.objectContaining({ code: "PIN-001", costUnitId: POUND_UNIT.id }))
        expect(result.code).toBe("PIN-001")
    })
})

describe("rawMaterialService.updateRawMaterial", () => {
    beforeEach(() => {
        mockRawMaterialFindOne.mockReset()
        mockFindOrCreatePoundUnit.mockReset()
        mockFindOrCreatePoundUnit.mockResolvedValue(POUND_UNIT)
    })

    it("rechaza actualizar el código a uno que ya usa OTRA materia prima, excluyendo el propio id de la búsqueda", async () => {
        const mockUpdate = jest.fn()
        mockRawMaterialFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("id" in where && !("code" in where)) return Promise.resolve({ id: 1, code: "OLD-001", update: mockUpdate }) // getRawMaterialById
            if ("code" in where) return Promise.resolve({ id: 2, code: "NEW-001" }) // otra materia prima ya tiene ese código
            return Promise.resolve(null)
        })

        await expect(
            rawMaterialService.updateRawMaterial(1, { code: "NEW-001", costPerUnit: 9.5 })
        ).rejects.toMatchObject({ statusCode: 409, key: "errors.raw_material_code_already_exists" })

        // La búsqueda de unicidad debe excluir el propio registro (id != 1) -- si no, una materia
        // prima nunca podría "actualizarse a sí misma" conservando su propio código.
        expect(mockRawMaterialFindOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ code: "NEW-001", id: { [Op.ne]: 1 } }) })
        )
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it("permite guardar sin cambiar de código (la unicidad no se compara consigo mismo) y sigue forzando costUnitId a la Libra", async () => {
        const mockUpdate = jest.fn().mockResolvedValue(undefined)
        mockRawMaterialFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("id" in where && !("code" in where)) {
                return Promise.resolve({ id: 1, code: "PIN-001", update: mockUpdate, translations: [] })
            }
            if ("code" in where) return Promise.resolve(null) // nadie más usa "PIN-001"
            return Promise.resolve(null)
        })

        await rawMaterialService.updateRawMaterial(1, { code: "PIN-001", costPerUnit: 10 })

        expect(mockFindOrCreatePoundUnit).toHaveBeenCalledTimes(1)
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ code: "PIN-001", costUnitId: POUND_UNIT.id }))
    })
})
