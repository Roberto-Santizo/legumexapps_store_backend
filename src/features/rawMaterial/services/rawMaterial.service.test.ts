import "reflect-metadata"
import ExcelJS from "exceljs"
import { Op } from "sequelize"

// Mock manual de los modelos que toca bulkImportRawMaterials; leer el .xlsx, mapear encabezados,
// resolver tipo/booleanos y generar slug corre real. unitService.findOrCreatePoundUnit se mockea.
jest.mock("../models/RawMaterial.model", () => ({
    __esModule: true,
    default: { sequelize: { transaction: jest.fn() }, bulkCreate: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() }
}))
jest.mock("../models/RawMaterialTranslation.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn() }
}))
jest.mock("../../rawMaterialTransformation/models/RawMaterialTransformation.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
jest.mock("../../unit/services/unit.service", () => ({
    __esModule: true,
    unitService: { findOrCreatePoundUnit: jest.fn() }
}))

import RawMaterial from "../models/RawMaterial.model"
import RawMaterialTranslation from "../models/RawMaterialTranslation.model"
import { unitService } from "../../unit/services/unit.service"
import RawMaterialTransformation from "../../rawMaterialTransformation/models/RawMaterialTransformation.model"
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

// "Código" primero, igual que la plantilla real (el parser mapea por nombre de encabezado).
const HEADERS = ["Código", "Nombre", "Tipo de materia prima", "Se puede mezclar (Sí/No)", "Costo por libra", "Nombre (inglés)"]

const transaction = { commit: jest.fn(), rollback: jest.fn() }
const mockTransaction = RawMaterial.sequelize!.transaction as jest.Mock
beforeEach(() => {
    transaction.commit.mockReset()
    transaction.rollback.mockReset()
    mockTransaction.mockImplementation(async callback => {
        try { const result = await callback(transaction); transaction.commit(); return result }
        catch (error) { transaction.rollback(); throw error }
    })
})

const POUND_UNIT = { id: 2, displayName: "Libra" }

describe("rawMaterialService.bulkImportRawMaterials", () => {
    it.each(["materials", "translations", "unit"])("rolls back the entire import on %s failure", async stage => {
        const error = new Error("synthetic write failure")
        if (stage === "materials") mockBulkCreate.mockRejectedValueOnce(error)
        if (stage === "translations") mockTranslationBulkCreate.mockRejectedValueOnce(error)
        if (stage === "unit") mockFindOrCreatePoundUnit.mockRejectedValueOnce(error)
        const buffer = await buildWorkbookBuffer(HEADERS, [Object.fromEntries(["SYN-001", "Synthetic", "Fruta", "No", 2, "Synthetic EN"].map((value, index) => [HEADERS[index], value]))])
        await expect(rawMaterialService.bulkImportRawMaterials(buffer)).rejects.toThrow(error)
        expect(transaction.rollback).toHaveBeenCalledTimes(1)
        expect(transaction.commit).not.toHaveBeenCalled()
        expect(mockFindOrCreatePoundUnit).toHaveBeenCalledWith(transaction)
        if (stage !== "unit") expect(mockBulkCreate.mock.calls[0][1].transaction).toBe(transaction)
        if (stage === "translations") expect(mockTranslationBulkCreate.mock.calls[0][1].transaction).toBe(transaction)
    })

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

    it.each(["No", "Sí", "obsolete non-boolean value"])("ignores the historical mixable column (%s) without persisting it", async legacy => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "SYN-001", "Nombre": "Synthetic raw", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5, "Se puede mezclar (Sí/No)": legacy },
        ])
        await rawMaterialService.bulkImportRawMaterials(buffer)
        expect(mockBulkCreate.mock.calls[0][0][0]).not.toHaveProperty("isMixable")
        expect(mockBulkCreate.mock.calls[0][0][0]).toMatchObject({ code: "SYN-001", costPerUnit: 9.5, ingredientType: "fruit" })
    })

    it("imports a new workbook without the retired column and preserves cost/name mapping", async () => {
        const headers = HEADERS.filter(header => !header.startsWith("Se puede mezclar"))
        const buffer = await buildWorkbookBuffer(headers, [
            { "Código": "SYN-001", "Nombre": "Synthetic raw", "Tipo de materia prima": "Fruta", "Costo por libra": 4.125, "Nombre (inglés)": "Synthetic EN" },
        ])
        await rawMaterialService.bulkImportRawMaterials(buffer)
        expect(mockBulkCreate.mock.calls[0][0][0]).toMatchObject({ code: "SYN-001", costPerUnit: 4.125 })
        expect(mockBulkCreate.mock.calls[0][0][0]).not.toHaveProperty("isMixable")
        expect(mockTranslationBulkCreate).toHaveBeenCalledWith([expect.objectContaining({ displayName: "Synthetic EN" })], { transaction })
    })

    it("importa filas válidas resolviendo el tipo por nombre y fuerza costUnitId a la Libra", async () => {
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
            })],
            { returning: true, transaction }
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
        ], { transaction })
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

    it("ignora la columna retirada \"Es la variante orgánica\" de una plantilla vieja y no guarda clasificación orgánica", async () => {
        const buffer = await buildWorkbookBuffer([...HEADERS, "Es la variante orgánica (Sí/No)"], [
            { "Código": "PIN-001", "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5, "Es la variante orgánica (Sí/No)": "tal vez" },
        ])

        await rawMaterialService.bulkImportRawMaterials(buffer)

        expect(mockBulkCreate.mock.calls[0][0][0]).not.toHaveProperty("isOrganic")
    })

    it("acepta un código sin formato de texto (Excel lo entrega como number, no debe romper la validación de string)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": 12345, "Nombre": "Piña", "Tipo de materia prima": "Fruta", "Costo por libra": 9.5 },
        ])

        await rawMaterialService.bulkImportRawMaterials(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith(
            [expect.objectContaining({ code: "12345" })],
            { returning: true, transaction }
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
            { returning: true, transaction }
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

describe("rawMaterialService.updateRawMaterial -- costo gestionado por Transformación de Materia Prima", () => {
    const mockTransformationFindOne = RawMaterialTransformation.findOne as unknown as jest.Mock
    let mockUpdate: jest.Mock

    beforeEach(() => {
        mockRawMaterialFindOne.mockReset()
        mockTransformationFindOne.mockReset()
        mockFindOrCreatePoundUnit.mockResolvedValue(POUND_UNIT)
        mockUpdate = jest.fn().mockResolvedValue(undefined)
        mockRawMaterialFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
            Promise.resolve("code" in where ? null : { id: 9, code: "BAN-P-001", costPerUnit: "0.2267", update: mockUpdate, translations: [] }))
    })

    it("rechaza cambiar el costo de una materia prima creada por una transformación y no escribe nada", async () => {
        mockTransformationFindOne.mockResolvedValue({ id: 5 })
        await expect(rawMaterialService.updateRawMaterial(9, { code: "BAN-P-001", costPerUnit: 0.3 }))
            .rejects.toMatchObject({ statusCode: 409, key: "errors.raw_material_cost_managed_by_transformation", params: { code: "BAN-P-001" } })
        expect(mockTransformationFindOne).toHaveBeenCalledWith({ where: { processedRawMaterialId: 9 }, attributes: ["id"] })
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it("permite editar los demás campos si el costo enviado es el mismo (sin consultar la transformación)", async () => {
        await rawMaterialService.updateRawMaterial(9, { code: "BAN-P-001", displayName: "BANANO PELADO", costPerUnit: 0.2267 })
        expect(mockTransformationFindOne).not.toHaveBeenCalled()
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ displayName: "BANANO PELADO", costPerUnit: 0.2267 }))
    })

    it("una materia prima sin transformación sigue pudiendo cambiar su costo", async () => {
        mockTransformationFindOne.mockResolvedValue(null)
        await rawMaterialService.updateRawMaterial(9, { code: "BAN-P-001", costPerUnit: 0.3 })
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ costPerUnit: 0.3 }))
    })
})
