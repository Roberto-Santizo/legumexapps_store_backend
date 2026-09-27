import "reflect-metadata"
import ExcelJS from "exceljs"

// Mismo patrón que productVariantImport.service.test.ts: modelos mockeados, archivos .xlsx reales
// armados en memoria, y sequelize.transaction invocando el callback con una transacción falsa.
jest.mock("../../../database/connection", () => ({
    __esModule: true,
    default: { transaction: jest.fn((callback: (t: unknown) => unknown) => callback({ __fakeTransaction: true })) }
}))
jest.mock("../models/Product.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/ProductTranslation.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../../category/models/SubCategory.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../category/models/Category.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../client/models/Client.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))

import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
import ProductTranslation from "../models/ProductTranslation.model"
import SubCategory from "../../category/models/SubCategory.model"
import Category from "../../category/models/Category.model"
import Client from "../../client/models/Client.model"
import { productImportService } from "./productImport.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockTransaction = sequelize.transaction as unknown as jest.Mock
const mockProductFindAll = Product.findAll as unknown as jest.Mock
const mockProductCreate = Product.create as unknown as jest.Mock
const mockTranslationCreate = ProductTranslation.create as unknown as jest.Mock
const mockSubCategoryFindAll = SubCategory.findAll as unknown as jest.Mock
const mockCategoryFindAll = Category.findAll as unknown as jest.Mock
const mockClientFindAll = Client.findAll as unknown as jest.Mock

type SheetRow = Record<string, string | number | undefined>

const HEADERS = [
    "Código Producto",
    "Subcategoría",
    "Categoría",
    "Cliente",
    "Nombre del producto",
    "Nombre del producto (inglés)",
    "Orgánico",
    "Tipo de receta",
    "Costo adicional por unidad",
]

async function buildWorkbookBuffer(rows: SheetRow[], headers: string[] = HEADERS): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Productos")
    sheet.addRow(headers)
    for (const row of rows) {
        sheet.addRow(headers.map(header => row[header]))
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer()
    return arrayBuffer as unknown as Buffer
}

const FRUTAS = { id: 1, displayName: "Frutas" }
const VEGETALES = { id: 2, displayName: "Vegetales" }
const JUGOS = { id: 10, displayName: "Jugos", categoryId: FRUTAS.id }
const CONGELADOS_FRUTAS = { id: 11, displayName: "Congelados", categoryId: FRUTAS.id }
const CONGELADOS_VEGETALES = { id: 12, displayName: "Congelados", categoryId: VEGETALES.id }
const WALMART = { id: 20, name: "Walmart" }

function baseRow(overrides: Partial<SheetRow> = {}): SheetRow {
    return {
        "Código Producto": "JUGO-PINA",
        "Subcategoría": "Jugos",
        "Cliente": "Walmart",
        "Nombre del producto": "Jugo de piña",
        "Tipo de receta": "Fija",
        ...overrides,
    }
}

async function expectRowIssues(buffer: Buffer, expected: object[]): Promise<void> {
    const error = await productImportService.bulkImportProducts(buffer).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BulkImportError)
    expect((error as BulkImportError).rowIssues).toEqual(expect.arrayContaining(expected.map(issue => expect.objectContaining(issue))))
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockProductCreate).not.toHaveBeenCalled()
}

describe("productImportService.bulkImportProducts", () => {
    let nextProductId = 100

    beforeEach(() => {
        nextProductId = 100
        mockTransaction.mockClear()
        mockProductFindAll.mockReset().mockResolvedValue([])
        mockProductCreate.mockReset().mockImplementation((data: object) => Promise.resolve({ id: nextProductId++, ...data }))
        mockTranslationCreate.mockReset().mockResolvedValue({})
        mockSubCategoryFindAll.mockReset().mockResolvedValue([JUGOS, CONGELADOS_FRUTAS, CONGELADOS_VEGETALES])
        mockCategoryFindAll.mockReset().mockResolvedValue([FRUTAS, VEGETALES])
        mockClientFindAll.mockReset().mockResolvedValue([WALMART])
    })

    it("crea un producto sin imagen dentro de UNA transacción, con su traducción al inglés", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Nombre del producto (inglés)": "Pineapple juice", "Orgánico": "Sí", "Costo adicional por unidad": 0.05 }),
        ])

        const result = await productImportService.bulkImportProducts(buffer)

        expect(result).toHaveLength(1)
        expect(mockTransaction).toHaveBeenCalledTimes(1)
        expect(mockProductCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                codigo: "JUGO-PINA",
                subCategoryId: JUGOS.id,
                clientId: WALMART.id,
                displayName: "Jugo de piña",
                isOrganic: true,
                isCustomizable: false,
                additionalCostPerUnit: 0.05,
                urlSlug: "jugo-de-pina",
                imageUrl: null,
            }),
            { transaction: { __fakeTransaction: true } }
        )
        expect(mockTranslationCreate).toHaveBeenCalledWith(
            { productId: 100, language: "en", displayName: "Pineapple juice" },
            { transaction: { __fakeTransaction: true } }
        )
    })

    it("Orgánico vacío = No, y sin nombre en inglés no crea traducción", async () => {
        const buffer = await buildWorkbookBuffer([baseRow()])

        await productImportService.bulkImportProducts(buffer)

        expect(mockProductCreate).toHaveBeenCalledWith(expect.objectContaining({ isOrganic: false }), expect.anything())
        expect(mockTranslationCreate).not.toHaveBeenCalled()
    })

    it.each([
        ["Personalizable", true],
        ["mezcla", true],
        ["customizable", true],
        ["FIJA", false],
        ["fixed", false],
    ])("Tipo de receta \"%s\" -> isCustomizable=%s", async (value, expected) => {
        const buffer = await buildWorkbookBuffer([baseRow({ "Tipo de receta": value })])

        await productImportService.bulkImportProducts(buffer)

        expect(mockProductCreate).toHaveBeenCalledWith(expect.objectContaining({ isCustomizable: expected }), expect.anything())
    })

    it("rechaza un Tipo de receta no reconocido o vacío", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Producto": "A", "Tipo de receta": "Mixta" }),
            baseRow({ "Código Producto": "B", "Tipo de receta": undefined }),
        ])

        await expectRowIssues(buffer, [
            { row: 2, field: "recipeType", key: "errors.bulk_import_invalid_recipe_type" },
            { row: 3, field: "recipeType", key: "errors.bulk_import_recipe_type_required" },
        ])
    })

    it("rechaza un valor de Orgánico que no es Sí/No", async () => {
        const buffer = await buildWorkbookBuffer([baseRow({ "Orgánico": "tal vez" })])

        await expectRowIssues(buffer, [{ row: 2, field: "isOrganic", key: "errors.bulk_import_invalid_boolean" }])
    })

    it("rechaza una Subcategoría inexistente", async () => {
        const buffer = await buildWorkbookBuffer([baseRow({ "Subcategoría": "Snacks" })])

        await expectRowIssues(buffer, [{ row: 2, field: "subCategory", key: "errors.bulk_import_subcategory_not_found" }])
    })

    it("rechaza una Subcategoría ambigua (mismo nombre en dos Categorías) si no se indica Categoría", async () => {
        const buffer = await buildWorkbookBuffer([baseRow({ "Subcategoría": "Congelados" })])

        await expectRowIssues(buffer, [{ row: 2, field: "subCategory", key: "errors.bulk_import_subcategory_ambiguous" }])
    })

    it("la columna Categoría desambigua la Subcategoría (sin importar mayúsculas/acentos)", async () => {
        const buffer = await buildWorkbookBuffer([baseRow({ "Subcategoría": "congelados", "Categoría": "VEGETALES" })])

        await productImportService.bulkImportProducts(buffer)

        expect(mockProductCreate).toHaveBeenCalledWith(expect.objectContaining({ subCategoryId: CONGELADOS_VEGETALES.id }), expect.anything())
    })

    it("rechaza una Subcategoría que no existe dentro de la Categoría indicada", async () => {
        const buffer = await buildWorkbookBuffer([baseRow({ "Subcategoría": "Jugos", "Categoría": "Vegetales" })])

        await expectRowIssues(buffer, [{ row: 2, field: "subCategory", key: "errors.bulk_import_subcategory_not_found_in_category" }])
    })

    it("rechaza una Categoría inexistente o ambigua", async () => {
        mockCategoryFindAll.mockResolvedValue([FRUTAS, VEGETALES, { id: 3, displayName: "Vegetales" }])
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Producto": "A", "Categoría": "Lácteos" }),
            baseRow({ "Código Producto": "B", "Categoría": "Vegetales" }),
        ])

        await expectRowIssues(buffer, [
            { row: 2, field: "category", key: "errors.bulk_import_category_not_found" },
            { row: 3, field: "category", key: "errors.bulk_import_category_ambiguous" },
        ])
    })

    it("rechaza un Cliente inexistente", async () => {
        const buffer = await buildWorkbookBuffer([baseRow({ "Cliente": "Costco" })])

        await expectRowIssues(buffer, [{ row: 2, field: "client", key: "errors.bulk_import_client_not_found" }])
    })

    it("rechaza un Cliente ambiguo (dos clientes activos con el mismo nombre)", async () => {
        mockClientFindAll.mockResolvedValue([WALMART, { id: 21, name: "walmart " }])
        const buffer = await buildWorkbookBuffer([baseRow()])

        await expectRowIssues(buffer, [{ row: 2, field: "client", key: "errors.bulk_import_client_ambiguous" }])
    })

    it("solo busca Subcategorías, Categorías y Clientes activos", async () => {
        const buffer = await buildWorkbookBuffer([baseRow()])

        await productImportService.bulkImportProducts(buffer)

        expect(mockSubCategoryFindAll).toHaveBeenCalledWith({ where: { isActive: true } })
        expect(mockCategoryFindAll).toHaveBeenCalledWith({ where: { isActive: true } })
        expect(mockClientFindAll).toHaveBeenCalledWith({ where: { isActive: true } })
    })

    it("rechaza un código que ya existe en el catálogo (sin importar mayúsculas)", async () => {
        mockProductFindAll.mockResolvedValue([{ codigo: "jugo-pina", urlSlug: "otro" }])
        const buffer = await buildWorkbookBuffer([baseRow()])

        await expectRowIssues(buffer, [{ row: 2, field: "codigo", key: "errors.product_codigo_already_exists" }])
    })

    it("rechaza un código repetido dentro del mismo archivo", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Producto": "JUGO-PINA" }),
            baseRow({ "Código Producto": "jugo-pina" }),
        ])

        await expectRowIssues(buffer, [
            { row: 3, field: "codigo", key: "errors.bulk_import_duplicate_code_in_file", params: { code: "jugo-pina", firstRow: 2 } },
        ])
    })

    it("valida con createProductSchema: nombre vacío y costo adicional negativo son errores de fila", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Producto": "A", "Nombre del producto": undefined }),
            baseRow({ "Código Producto": "B", "Costo adicional por unidad": -1 }),
        ])

        await expectRowIssues(buffer, [
            { row: 2, field: "displayName" },
            { row: 3, field: "additionalCostPerUnit" },
        ])
    })

    it("dos productos con el mismo nombre (y uno ya en la BD) reciben slugs distintos", async () => {
        mockProductFindAll.mockResolvedValue([{ codigo: "OTRO", urlSlug: "jugo-de-pina" }])
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Producto": "A" }),
            baseRow({ "Código Producto": "B" }),
        ])

        await productImportService.bulkImportProducts(buffer)

        const slugs = mockProductCreate.mock.calls.map(([data]) => (data as { urlSlug: string }).urlSlug)
        expect(slugs).toEqual(["jugo-de-pina-2", "jugo-de-pina-3"])
    })

    it("todo-o-nada: una fila mala junto a una buena no crea ningún producto, y reporta todos los errores", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Producto": "BUENO" }),
            baseRow({ "Código Producto": "MALO", "Cliente": "Costco", "Subcategoría": "Snacks" }),
        ])

        await expectRowIssues(buffer, [
            { row: 3, field: "client", key: "errors.bulk_import_client_not_found" },
            { row: 3, field: "subCategory", key: "errors.bulk_import_subcategory_not_found" },
        ])
    })

    it("rechaza un archivo sin las columnas obligatorias", async () => {
        const buffer = await buildWorkbookBuffer([{ "Código Producto": "A" }], ["Código Producto"])

        await expect(productImportService.bulkImportProducts(buffer)).rejects.toMatchObject({
            key: "errors.bulk_import_missing_columns",
        })
    })

    it("acepta un archivo sin las columnas opcionales (Categoría, inglés, Orgánico, Costo adicional)", async () => {
        const headers = ["Código Producto", "Subcategoría", "Cliente", "Nombre del producto", "Tipo de receta"]
        const buffer = await buildWorkbookBuffer([baseRow()], headers)

        const result = await productImportService.bulkImportProducts(buffer)

        expect(result).toHaveLength(1)
    })
})

describe("productImportService.buildProductImportTemplate", () => {
    it("la plantilla descargable trae los encabezados que el importador reconoce", async () => {
        const buffer = await productImportService.buildProductImportTemplate()
        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo cast que excelImport.util.ts
        await workbook.xlsx.load(buffer as any)
        const headerRow = workbook.worksheets[0].getRow(1).values as unknown[]

        expect(headerRow.filter(Boolean)).toEqual(HEADERS)
    })
})
