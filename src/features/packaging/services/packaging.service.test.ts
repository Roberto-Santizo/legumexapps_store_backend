import "reflect-metadata"
import ExcelJS from "exceljs"
import { Op } from "sequelize"

// Mock manual del modelo; leer el .xlsx, mapear encabezados y validar cada fila corre real, con
// archivos .xlsx armados en cada test (no hay atajo honesto para probar un parser de Excel).
jest.mock("../models/Packaging.model", () => ({
    __esModule: true,
    default: { bulkCreate: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn() }
}))

import Packaging from "../models/Packaging.model"
import { packagingService } from "./packaging.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockBulkCreate = Packaging.bulkCreate as unknown as jest.Mock
const mockPackagingFindOne = Packaging.findOne as unknown as jest.Mock
const mockPackagingFindAll = Packaging.findAll as unknown as jest.Mock
const mockPackagingCreate = Packaging.create as unknown as jest.Mock

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

// "Código" primero a propósito, igual que la plantilla real -- pero el parser mapea por nombre
// de encabezado, no por posición, así que el orden acá no es lo que se está probando.
const HEADERS = ["Código", "Nombre", "Rol del material", "Costo por unidad (USD)"]

describe("packagingService.bulkImportPackagings", () => {
    beforeEach(() => {
        mockBulkCreate.mockReset()
        mockBulkCreate.mockImplementation((rows: unknown[]) => Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) }))))
        mockPackagingFindAll.mockReset()
        mockPackagingFindAll.mockResolvedValue([]) // ningún código ya existe en la BD, por defecto
    })

    it.each(["Costo por unidad (USD)", "Costo por unidad (Q)"])("conserva 0.03 sin conversión con el encabezado %s", async header => {
        const buffer = await buildWorkbookBuffer(["Código", "Nombre", "Rol del material", header], [
            { "Código": "USD-001", "Nombre": "Bolsa", "Rol del material": "unit", [header]: 0.03 },
        ])

        await packagingService.bulkImportPackagings(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith([
            { code: "USD-001", displayName: "Bolsa", packagingRole: "unit", unitCost: 0.03 },
        ])
    })

    it("importa todas las filas válidas de un archivo bien formado (los 3 roles)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "BOL-001", "Nombre": "Bolsa plástica 2kg", "Rol del material": "Empaque individual", "Costo por unidad (USD)": 1.25 },
            { "Código": "BOL-002", "Nombre": "Bolsa grande 50u", "Rol del material": "Empaque intermedio (bolsa grande)", "Costo por unidad (USD)": 3.5 },
            { "Código": "CAJ-001", "Nombre": "Caja corrugada master", "Rol del material": "Material de paletización", "Costo por unidad (USD)": 2 },
        ])

        const result = await packagingService.bulkImportPackagings(buffer)

        expect(result).toHaveLength(3)
        expect(mockBulkCreate).toHaveBeenCalledWith([
            { code: "BOL-001", displayName: "Bolsa plástica 2kg", packagingRole: "unit", unitCost: 1.25 },
            { code: "BOL-002", displayName: "Bolsa grande 50u", packagingRole: "intermediate", unitCost: 3.5 },
            { code: "CAJ-001", displayName: "Caja corrugada master", packagingRole: "pallet", unitCost: 2 },
        ])
    })

    it("acepta la key interna en inglés como alternativa al label en español (\"pallet\" en vez de \"Material de paletización\")", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "PAR-001", "Nombre": "Parales", "Rol del material": "pallet", "Costo por unidad (USD)": 1 },
        ])

        const result = await packagingService.bulkImportPackagings(buffer)

        expect(result).toHaveLength(1)
    })

    it("tolera variaciones de encabezado (mayúsculas, alias corto \"Rol\", sin acentos) sin perder columnas", async () => {
        const buffer = await buildWorkbookBuffer(["CODIGO", "NOMBRE", "rol", "costo por unidad"], [
            { "CODIGO": "BOL-999", "NOMBRE": "Bolsa test", "rol": "unit", "costo por unidad": 5 },
        ])

        const result = await packagingService.bulkImportPackagings(buffer)

        expect(result).toHaveLength(1)
        expect(mockBulkCreate).toHaveBeenCalledWith([
            { code: "BOL-999", displayName: "Bolsa test", packagingRole: "unit", unitCost: 5 },
        ])
    })

    it("no crea NADA si una sola fila falla validación (todo o nada) -- rechaza con BulkImportError", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "BOL-001", "Nombre": "Bolsa buena", "Rol del material": "unit", "Costo por unidad (USD)": 1 },
            { "Código": "BOL-002", "Nombre": "Bolsa sin costo", "Rol del material": "unit" }, // unitCost requerido, ver createPackagingSchema
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("reporta el número de fila correcto (1-based, contando el encabezado) en el error", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "BOL-001", "Nombre": "Bolsa buena", "Rol del material": "unit", "Costo por unidad (USD)": 1 },
            { "Código": "BOL-002", "Nombre": "Bolsa mala", "Rol del material": "unit" }, // fila 3 del archivo (1=encabezado, 2=buena, 3=mala)
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
            { "Código": "BOL-001", "Nombre": "Bolsa rara", "Rol del material": "paletizacion mal escrito", "Costo por unidad (USD)": 1 },
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "packagingRole", key: "errors.bulk_import_unknown_role" })]
        })
    })

    it("rechaza un nombre duplicado dentro del MISMO archivo (pegado dos veces por error)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "BOL-001", "Nombre": "Bolsa repetida", "Rol del material": "unit", "Costo por unidad (USD)": 1 },
            { "Código": "BOL-002", "Nombre": "bolsa repetida", "Rol del material": "unit", "Costo por unidad (USD)": 2 }, // mismo nombre, distinto case
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "displayName", key: "errors.bulk_import_duplicate_name_in_file" })]
        })
    })

    it("rechaza un código duplicado dentro del MISMO archivo (sin distinguir mayúsculas)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "BOL-001", "Nombre": "Bolsa uno", "Rol del material": "unit", "Costo por unidad (USD)": 1 },
            { "Código": "bol-001", "Nombre": "Bolsa dos", "Rol del material": "unit", "Costo por unidad (USD)": 2 },
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 3, field: "code", key: "errors.bulk_import_duplicate_code_in_file" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza un código que ya existe en la BD (activo o no)", async () => {
        mockPackagingFindAll.mockResolvedValue([{ code: "BOL-001" }])
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "BOL-001", "Nombre": "Bolsa nueva", "Rol del material": "unit", "Costo por unidad (USD)": 1 },
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ field: "code", key: "errors.packaging_code_already_exists" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza una fila con la celda de Código vacía (columna requerida) en vez de insertarla sin código", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Nombre": "Bolsa sin código", "Rol del material": "unit", "Costo por unidad (USD)": 1 }, // sin "Código"
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 2, field: "code" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("rechaza una fila con el Código de solo espacios en blanco", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "   ", "Nombre": "Bolsa", "Rol del material": "unit", "Costo por unidad (USD)": 1 },
        ])

        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ row: 2, field: "code" })]
        })
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })

    it("acepta un código sin formato de texto (Excel lo entrega como number, no debe romper la validación de string)", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": 12345, "Nombre": "Bolsa", "Rol del material": "unit", "Costo por unidad (USD)": 1 },
        ])

        await packagingService.bulkImportPackagings(buffer)

        expect(mockBulkCreate).toHaveBeenCalledWith([
            expect.objectContaining({ code: "12345" })
        ])
    })

    it("ignora filas completamente vacías (huecos que deja Excel) sin tratarlas como error", async () => {
        const buffer = await buildWorkbookBuffer(HEADERS, [
            { "Código": "BOL-001", "Nombre": "Bolsa buena", "Rol del material": "unit", "Costo por unidad (USD)": 1 },
            {},
        ])

        const result = await packagingService.bulkImportPackagings(buffer)

        expect(result).toHaveLength(1)
    })

    it("rechaza el archivo si le falta una columna requerida (ej. no trae \"Costo por unidad\")", async () => {
        const buffer = await buildWorkbookBuffer(["Código", "Nombre", "Rol del material"], [
            { "Código": "BOL-001", "Nombre": "Bolsa", "Rol del material": "unit" },
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
            { "Código": "BOL-001", "Nombre": "Bolsa", "Rol del material": "unit", "Costo por unidad (USD)": "2.50" },
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
        mockPackagingFindAll.mockResolvedValue([])
        mockBulkCreate.mockImplementation((rows: unknown[]) => Promise.resolve(rows.map((row, index) => ({ id: index + 1, ...(row as object) }))))

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

const BASE_CREATE_INPUT = {
    code: "BOL-001",
    displayName: "Bolsa plástica 2kg",
    packagingRole: "unit" as const,
    unitCost: 1.25,
}

describe("packagingService.createPackaging", () => {
    beforeEach(() => {
        mockPackagingFindOne.mockReset()
        mockPackagingCreate.mockReset()
    })

    it("rechaza crear un material si el código ya existe (activo o no), sin llegar a Packaging.create", async () => {
        mockPackagingFindOne.mockResolvedValueOnce({ id: 5, code: "BOL-001" })

        await expect(packagingService.createPackaging(BASE_CREATE_INPUT)).rejects.toMatchObject({
            statusCode: 409,
            key: "errors.packaging_code_already_exists",
            params: { code: "BOL-001" },
        })
        expect(mockPackagingCreate).not.toHaveBeenCalled()
    })

    it("crea el material cuando el código no existe todavía", async () => {
        mockPackagingFindOne.mockResolvedValue(null) // código libre
        mockPackagingCreate.mockResolvedValue({ id: 1, ...BASE_CREATE_INPUT })

        const result = await packagingService.createPackaging(BASE_CREATE_INPUT)

        expect(mockPackagingCreate).toHaveBeenCalledWith(expect.objectContaining({ code: "BOL-001" }))
        expect(result.code).toBe("BOL-001")
    })
})

describe("packagingService.updatePackaging", () => {
    beforeEach(() => {
        mockPackagingFindOne.mockReset()
    })

    it("rechaza actualizar el código a uno que ya usa OTRO material, excluyendo el propio id de la búsqueda", async () => {
        const mockUpdate = jest.fn()
        mockPackagingFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("id" in where && !("code" in where)) return Promise.resolve({ id: 1, code: "OLD-001", update: mockUpdate }) // getPackagingById
            if ("code" in where) return Promise.resolve({ id: 2, code: "NEW-001" }) // otro material ya tiene ese código
            return Promise.resolve(null)
        })

        await expect(
            packagingService.updatePackaging(1, { code: "NEW-001", packagingRole: "unit", unitCost: 1 })
        ).rejects.toMatchObject({ statusCode: 409, key: "errors.packaging_code_already_exists" })

        // La búsqueda de unicidad debe excluir el propio registro (id != 1) -- si no, un material
        // nunca podría "actualizarse a sí mismo" conservando su propio código.
        expect(mockPackagingFindOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ code: "NEW-001", id: { [Op.ne]: 1 } }) })
        )
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it("permite guardar sin cambiar de código (la unicidad no se compara consigo mismo)", async () => {
        const mockUpdate = jest.fn().mockResolvedValue(undefined)
        mockPackagingFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("id" in where && !("code" in where)) return Promise.resolve({ id: 1, code: "BOL-001", update: mockUpdate })
            if ("code" in where) return Promise.resolve(null) // nadie más usa "BOL-001"
            return Promise.resolve(null)
        })

        await packagingService.updatePackaging(1, { code: "BOL-001", packagingRole: "unit", unitCost: 2 })

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ code: "BOL-001" }))
    })
})


describe("packaging catalog consumption import and update", () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockPackagingFindAll.mockResolvedValue([])
        mockBulkCreate.mockImplementation(async values => values)
    })
    it("imports friendly structured consumption columns for all initial rules", async () => {
        const headers = [...HEADERS, "FORMA DE CONSUMO", "CANTIDAD DE CONSUMO"]
        const buffer = await buildWorkbookBuffer(headers, [["POR CAJA", 1], ["POR PALLET", 4], ["POR PALLET", 1], ["POR PALLET", 93.3]].map(([basis, value], index) => ({
            "Código": `MP-${index}`, "Nombre": `Unclassified ${index}`, "Rol del material": "pallet", "Costo por unidad (USD)": 1,
            "FORMA DE CONSUMO": basis, "CANTIDAD DE CONSUMO": value,
        })))
        await packagingService.bulkImportPackagings(buffer)
        expect(mockBulkCreate).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ defaultQuantityBasis: "per_box", defaultQuantityValue: 1 }),
            expect.objectContaining({ defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4 }),
            expect.objectContaining({ defaultQuantityBasis: "per_pallet", defaultQuantityValue: 1 }),
            expect.objectContaining({ defaultQuantityBasis: "per_pallet", defaultQuantityValue: 93.3 }),
        ]))
    })
    it.each([["POR CAJA", undefined], [undefined, 1], ["POR PALLET", 0], ["UNKNOWN", 4]])("rejects invalid imported catalog defaults %s/%s without writes", async (basis, value) => {
        const buffer = await buildWorkbookBuffer([...HEADERS, "FORMA DE CONSUMO", "CANTIDAD DE CONSUMO"], [{
            "Código": "MP-X", "Nombre": "Unclassified", "Rol del material": "pallet", "Costo por unidad (USD)": 1,
            "FORMA DE CONSUMO": basis, "CANTIDAD DE CONSUMO": value,
        }])
        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockBulkCreate).not.toHaveBeenCalled()
    })
    it("changing catalog consumption only writes Packaging", async () => {
        const update = jest.fn(async values => values)
        const material = { ...BASE_CREATE_INPUT, packagingRole: "pallet", id: 100, defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4, update }
        mockPackagingFindOne.mockResolvedValueOnce(material).mockResolvedValueOnce(null)
        await packagingService.updatePackaging(100, { ...BASE_CREATE_INPUT, packagingRole: "pallet", defaultQuantityBasis: "per_pallet", defaultQuantityValue: 5 })
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ defaultQuantityValue: 5 }))
        expect(material.defaultQuantityValue).toBe(4)
    })
    it("preserves defaults when old clients omit both fields", async () => {
        const update = jest.fn()
        mockPackagingFindOne.mockResolvedValueOnce({ ...BASE_CREATE_INPUT, packagingRole: "pallet", defaultQuantityBasis: "per_pallet", defaultQuantityValue: "4.00", update }).mockResolvedValueOnce(null)
        await packagingService.updatePackaging(100, { ...BASE_CREATE_INPUT, packagingRole: "pallet" })
        expect(update).toHaveBeenCalledWith({ ...BASE_CREATE_INPUT, packagingRole: "pallet" })
    })
    it("clears unused pallet defaults when changing to a non-pallet role", async () => {
        const update = jest.fn()
        mockPackagingFindOne.mockResolvedValueOnce({ ...BASE_CREATE_INPUT, packagingRole: "pallet", defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4, update }).mockResolvedValueOnce(null)
        await packagingService.updatePackaging(100, BASE_CREATE_INPUT)
        expect(update).toHaveBeenCalledWith({ ...BASE_CREATE_INPUT, defaultQuantityBasis: null, defaultQuantityValue: null })
    })
})


describe("packagingService.listPackagings search", () => {
    const findAndCountAll = Packaging.findAndCountAll as unknown as jest.Mock
    beforeEach(() => {
        findAndCountAll.mockReset()
        mockPackagingFindAll.mockReset()
    })

    // Verify the ORM query contract: PostgreSQL receives both ILIKE predicates
    // before applying limit/offset, rather than filtering the loaded page in JS.
    it.each([
        ["material name", "Caja Strawberry"],
        ["full material code", "ME-CW0047"],
        ["partial code prefix", "ME-CW"],
        ["partial code suffix", "0047"],
        ["partial name", "Strawberry"],
        ["mixed-case name", "sTrAwBeRrY"],
        ["lowercase code", "me-cw0047"],
    ])("searches by %s with case-insensitive name OR code predicates", async (_label, search) => {
        const rows = [{ id: 47, code: "ME-CW0047", displayName: "Caja Strawberry", isActive: true }]
        findAndCountAll.mockResolvedValue({ rows, count: 1 })

        const result = await packagingService.listPackagings({ page: 1, limit: 10 }, search)

        expect(findAndCountAll).toHaveBeenCalledWith({
            where: {
                isActive: true,
                [Op.or]: [
                    { displayName: { [Op.iLike]: `%${search}%` } },
                    { code: { [Op.iLike]: `%${search}%` } },
                ],
            },
            order: [["displayName", "DESC"]],
            limit: 10, offset: 0, distinct: true,
        })
        expect(result).toEqual({ data: rows, meta: { page: 1, limit: 10, total: 1, totalPages: 1 } })
        expect(mockPackagingFindAll).not.toHaveBeenCalled()
    })

    it("returns an empty page with valid pagination when there are no matches", async () => {
        findAndCountAll.mockResolvedValue({ rows: [], count: 0 })
        const result = await packagingService.listPackagings({ page: 1, limit: 10 }, "NOT-FOUND")
        expect(result).toEqual({ data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } })
        expect(findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
            where: { isActive: true, [Op.or]: [
                { displayName: { [Op.iLike]: "%NOT-FOUND%" } },
                { code: { [Op.iLike]: "%NOT-FOUND%" } },
            ] },
        }))
    })

    it("preserves active filtering, ordering, and page offset during search", async () => {
        findAndCountAll.mockResolvedValue({ rows: [], count: 35 })
        const result = await packagingService.listPackagings({ page: 3, limit: 5 }, "ME-CW")
        expect(findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ isActive: true }),
            order: [["displayName", "DESC"]], limit: 5, offset: 10, distinct: true,
        }))
        expect(result.meta).toEqual({ page: 3, limit: 5, total: 35, totalPages: 7 })
    })

    it("keeps the existing unfiltered listing when search is empty", async () => {
        findAndCountAll.mockResolvedValue({ rows: [], count: 0 })
        await packagingService.listPackagings({ page: 1 }, "")
        expect(findAndCountAll).toHaveBeenCalledWith({
            where: { isActive: true }, order: [["displayName", "DESC"]],
            limit: 10, offset: 0, distinct: true,
        })
    })
})
