import "reflect-metadata"
import ExcelJS from "exceljs"

// Modelos mockeados, archivos .xlsx reales
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
jest.mock("../models/ProductVariant.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../../presentation/models/Presentation.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
import ProductVariant from "../models/ProductVariant.model"
import Presentation from "../../presentation/models/Presentation.model"
import { PRODUCT_IMPORT_COLUMNS } from "../constants/productImport.constant"
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

const HEADERS = Object.values(PRODUCT_IMPORT_COLUMNS).map(column => column.header)

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
        "SKU / Número de artículo": "JUGO-PINA",
        "Grupo de producto": overrides["SKU / Número de artículo"] ?? "G-1",
        "Presentación": "Bolsa 500 g",
        "Cajas por palet": 40,
        "Bolsas por caja": 12,
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
        (ProductVariant.findAll as jest.Mock).mockReset().mockResolvedValue([])
        ;(ProductVariant.create as jest.Mock).mockReset().mockImplementation(async data => ({ id: 200, ...data }))
        ;(Presentation.findAll as jest.Mock).mockReset().mockResolvedValue([{ id: 30, displayLabel: "Bolsa 500 g" }, { id: 31, displayLabel: "Bolsa 2 kg" }])
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

        expect(result).toEqual({ products: 1, variants: 1 })
        expect(mockTransaction).toHaveBeenCalledTimes(1)
        expect(mockProductCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                
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
            baseRow({ "SKU / Número de artículo": "A", "Tipo de receta": "Mixta" }),
            baseRow({ "SKU / Número de artículo": "B", "Tipo de receta": undefined }),
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
            baseRow({ "SKU / Número de artículo": "A", "Categoría": "Lácteos" }),
            baseRow({ "SKU / Número de artículo": "B", "Categoría": "Vegetales" }),
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
        (ProductVariant.findAll as jest.Mock).mockResolvedValue([{ skuCode: "jugo-pina", isActive: false }])
        const buffer = await buildWorkbookBuffer([baseRow()])

        await expectRowIssues(buffer, [{ row: 2, field: "skuCode", key: "errors.product_variant_skucode_already_exists" }])
    })

    it("rechaza un código repetido dentro del mismo archivo", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "SKU / Número de artículo": "JUGO-PINA" }),
            baseRow({ "SKU / Número de artículo": "jugo-pina" }),
        ])

        await expectRowIssues(buffer, [
            { row: 3, field: "skuCode", key: "errors.bulk_import_duplicate_code_in_file", params: { code: "jugo-pina", firstRow: 2 } },
        ])
    })

    it("valida con createProductSchema: nombre vacío y costo adicional negativo son errores de fila", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "SKU / Número de artículo": "A", "Nombre del producto": undefined }),
            baseRow({ "SKU / Número de artículo": "B", "Costo adicional por unidad": -1 }),
        ])

        await expectRowIssues(buffer, [
            { row: 2, field: "displayName" },
            { row: 3, field: "additionalCostPerUnit" },
        ])
    })

    it("dos productos con el mismo nombre (y uno ya en la BD) reciben slugs distintos", async () => {
        mockProductFindAll.mockResolvedValue([{ codigo: "OTRO", urlSlug: "jugo-de-pina" }])
        const buffer = await buildWorkbookBuffer([
            baseRow({ "SKU / Número de artículo": "A" }),
            baseRow({ "SKU / Número de artículo": "B" }),
        ])

        await productImportService.bulkImportProducts(buffer)

        const slugs = mockProductCreate.mock.calls.map(([data]) => (data as { urlSlug: string }).urlSlug)
        expect(slugs).toEqual(["jugo-de-pina-2", "jugo-de-pina-3"])
    })

    it("todo-o-nada: una fila mala junto a una buena no crea ningún producto, y reporta todos los errores", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "SKU / Número de artículo": "BUENO" }),
            baseRow({ "SKU / Número de artículo": "MALO", "Cliente": "Costco", "Subcategoría": "Snacks" }),
        ])

        await expectRowIssues(buffer, [
            { row: 3, field: "client", key: "errors.bulk_import_client_not_found" },
            { row: 3, field: "subCategory", key: "errors.bulk_import_subcategory_not_found" },
        ])
    })

    it("crea un producto una vez con dos SKUs del mismo grupo", async () => {
        const result = await productImportService.bulkImportProducts(await buildWorkbookBuffer([
            baseRow(), baseRow({ "SKU / Número de artículo": "SECOND", "Grupo de producto": "G-1", "Presentación": "Bolsa 2 kg", "Unidades por empaque intermedio": 6 }),
        ]))
        expect(result).toEqual({ products: 1, variants: 2 })
        expect(mockProductCreate).toHaveBeenCalledTimes(1)
        expect(ProductVariant.create).toHaveBeenCalledTimes(2)
        expect(ProductVariant.create).toHaveBeenLastCalledWith(expect.objectContaining({ productId: 100, skuCode: "SECOND", unitsPerIntermediatePackage: 6 }), expect.anything())
        expect(mockProductCreate.mock.calls[0][0]).not.toHaveProperty("codigo")
    })

    it.each([
        ["Nombre del producto", "Otro nombre", "displayName"],
        ["Nombre del producto (inglés)", "Different", "translations"],
        ["Orgánico", "Sí", "isOrganic"],
        ["Tipo de receta", "Personalizable", "isCustomizable"],
        ["Costo adicional por unidad", 1, "additionalCostPerUnit"],
        ["Subcategoría", "Congelados", "subCategoryId"],
        ["Cliente", "Costco", "clientId"],
    ])("rechaza inconsistencia de %s dentro del grupo", async (column, value, field) => {
        mockClientFindAll.mockResolvedValue([WALMART, { id: 21, name: "Costco" }])
        await expectRowIssues(await buildWorkbookBuffer([
            baseRow(), baseRow({ "SKU / Número de artículo": "SECOND", "Grupo de producto": "G-1", "Presentación": "Bolsa 2 kg", [column]: value, ...(column === "Subcategoría" ? { "Categoría": "Frutas" } : {}) }),
        ]), [{ row: 3, field, key: "errors.bulk_import_product_group_inconsistent" }])
        expect(ProductVariant.create).not.toHaveBeenCalled()
    })

    it("Categoría debe repetirse consistentemente dentro del grupo", async () => {
        await expectRowIssues(await buildWorkbookBuffer([baseRow(), baseRow({ "SKU / Número de artículo": "SECOND", "Grupo de producto": "G-1", "Presentación": "Bolsa 2 kg", "Categoría": "Frutas" })]), [{ row: 3, field: "category", key: "errors.bulk_import_product_group_inconsistent" }])
    })
    it("rechaza grupo vacío y conteos inválidos sin escribir", async () => {
        await expectRowIssues(await buildWorkbookBuffer([baseRow({ "Grupo de producto": " ", "Cajas por palet": 0 })]), [{ field: "productGroup" }, { field: "boxesPerPallet" }])
    })

    it("rechaza presentación inexistente o ambigua", async () => {
        (Presentation.findAll as jest.Mock).mockResolvedValue([{ id: 30, displayLabel: "Duplicada" }, { id: 31, displayLabel: "Duplicada" }])
        await expectRowIssues(await buildWorkbookBuffer([baseRow({ "Presentación": "Duplicada" })]), [{ key: "errors.bulk_import_presentation_ambiguous" }])
        await expectRowIssues(await buildWorkbookBuffer([baseRow({ "Presentación": "Nada" })]), [{ key: "errors.bulk_import_presentation_not_found" }])
    })

    it("rechaza dos variantes de la misma presentación en un producto", async () => {
        await expectRowIssues(await buildWorkbookBuffer([baseRow(), baseRow({ "SKU / Número de artículo": "SECOND", "Grupo de producto": "G-1" })]), [{ row: 3, key: "errors.product_variant_presentation_already_used" }])
    })

    it("propaga un fallo de escritura desde la única transacción", async () => {
        (ProductVariant.create as jest.Mock).mockRejectedValueOnce(new Error("write failed"))
        await expect(productImportService.bulkImportProducts(await buildWorkbookBuffer([baseRow()]))).rejects.toThrow("write failed")
        expect(mockTransaction).toHaveBeenCalledTimes(1)
        expect(ProductVariant.create).toHaveBeenCalledWith(expect.anything(), { transaction: { __fakeTransaction: true } })
    })

    it("rechaza un archivo sin las columnas obligatorias", async () => {
        const buffer = await buildWorkbookBuffer([{ "SKU / Número de artículo": "A" }], ["SKU / Número de artículo"])

        await expect(productImportService.bulkImportProducts(buffer)).rejects.toMatchObject({
            key: "errors.bulk_import_missing_columns",
        })
    })

    it("acepta un archivo sin las columnas opcionales (Categoría, inglés, Orgánico, Costo adicional)", async () => {
        const headers = ["Grupo de producto", "SKU / Número de artículo", "Presentación", "Cajas por palet", "Bolsas por caja", "Subcategoría", "Cliente", "Nombre del producto", "Tipo de receta"]
        const buffer = await buildWorkbookBuffer([baseRow()], headers)

        const result = await productImportService.bulkImportProducts(buffer)

        expect(result).toEqual({ products: 1, variants: 1 })
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
