import "reflect-metadata"
import ExcelJS from "exceljs"
import JSZip from "jszip"
import request from "supertest"
import jwt from "jsonwebtoken"
import { readFile, writeFile, mkdtemp, unlink, rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import productRouter from "../routes/product.routes"
import { loadWorkbookFromBuffer, writeWorkbookToBuffer } from "../../../shared/utils/excelImport.util"
import { prefixSpreadsheetNamespaces } from "../../../shared/test-utils/xlsxCompatibility.fixture"

jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" } }))
jest.mock("./product.service", () => ({ productService: {} }))

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

jest.mock("../../packaging/models/Packaging.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../packagingGroup/models/PackagingGroup.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/ProductVariantUnitMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/ProductVariantIntermediateMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/ProductVariantPalletMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
import Packaging from "../../packaging/models/Packaging.model"
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model"
import UnitMaterial from "../models/ProductVariantUnitMaterial.model"
import IntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import PalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { INITIAL_PACKAGING_COLUMNS, INITIAL_PRODUCT_SHEET, INITIAL_PACKAGING_SHEET } from "../constants/initialPackagingImport.constant"
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
    // HTTP, disk I/O and repeated XLSX/ZIP processing need extra time on slower test runners.
    it("downloads the real template and reuploads identical bytes through the real preview endpoint", async () => {
        (PackagingGroup.findAll as jest.Mock).mockResolvedValue([{ displayName: "Opciones reales" }])
        const app = buildTestApp("/api/products", productRouter)
        const token = jwt.sign({ sub: 1, type: "staff", permissions: ["products:create"] }, "test-secret")
        const download = await request(app).get("/api/products/bulk-import/template").set("Authorization", `Bearer ${token}`)
            .buffer(true).parse((response, callback) => {
                const chunks: Buffer[] = []
                response.on("data", chunk => chunks.push(Buffer.from(chunk)))
                response.on("end", () => callback(null, Buffer.concat(chunks)))
                response.on("error", callback)
            })
        expect(download.status).toBe(200)
        expect(Buffer.isBuffer(download.body)).toBe(true)
        const directory = await mkdtemp(join(tmpdir(), "legumex-xlsx-"))
        const path = join(directory, "downloaded.xlsx")
        try {
            await writeFile(path, download.body)
            const buffer = await readFile(path)
            const workbook = await loadWorkbookFromBuffer(buffer)
            expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([INITIAL_PRODUCT_SHEET, INITIAL_PACKAGING_SHEET, "INSTRUCCIONES"])
            const original = productImportService.previewProductImport
            const received = jest.spyOn(productImportService, "previewProductImport").mockImplementation(async uploaded => {
                expect(Buffer.isBuffer(uploaded)).toBe(true)
                expect(uploaded.equals(buffer)).toBe(true)
                return original(uploaded)
            })
            try {
                const response = await request(app).post("/api/products/bulk-import/preview")
                    .set("Authorization", `Bearer ${token}`)
                    .attach("file", buffer, { filename: "downloaded.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
                expect(received).toHaveBeenCalledTimes(1)
                expect(response.status).toBe(422)
                expect(response.body.message).not.toMatch(/sheets|TypeError|internal/i)
                const zip = await JSZip.loadAsync(buffer)
                for (const entry of ["[Content_Types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"]) {
                    expect(await zip.file(entry)?.async("string")).toMatch(/^<\?xml/)
                }
                zip.file("xl/workbook.xml", "")
                const corrupt = await zip.generateAsync({ type: "nodebuffer" })
                received.mockImplementation(original)
                const logged = jest.spyOn(console, "error").mockImplementation(() => undefined)
                try {
                    const failed = await request(app).post("/api/products/bulk-import/preview")
                        .set("Authorization", `Bearer ${token}`)
                        .attach("file", corrupt, { filename: "corrupt.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
                    expect(failed.status).toBe(422)
                    expect(failed.body.message).toContain(".xlsx")
                    expect(JSON.stringify(failed.body)).not.toMatch(/TypeError|sheets|stack|XLSX.load/)
                    expect(logged).not.toHaveBeenCalled()
                } finally { logged.mockRestore() }
            } finally { received.mockRestore() }
        } finally {
            await unlink(path)
            await rmdir(directory)
        }
    }, 15_000)
    it("la plantilla descargable trae los encabezados que el importador reconoce", async () => {
        (PackagingGroup.findAll as jest.Mock).mockResolvedValue([{ displayName: "Opciones reales" }])
        const buffer = await productImportService.buildProductImportTemplate()
        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo cast que excelImport.util.ts
        await workbook.xlsx.load(buffer as any)
        const headerRow = workbook.worksheets[0].getRow(1).values as unknown[]

        expect(headerRow.filter(Boolean)).toEqual(HEADERS.map(header => header.toUpperCase()))
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([INITIAL_PRODUCT_SHEET, INITIAL_PACKAGING_SHEET, "INSTRUCCIONES"])
        expect(workbook.worksheets[0].rowCount).toBe(1)
        const materials = workbook.worksheets[1]
        expect(materials.getRow(1).values).toEqual([undefined, ...Object.values(INITIAL_PACKAGING_COLUMNS).map(column => column.header)])
        expect(materials.getCell("C2").dataValidation.formulae?.[0]).toContain("ESQUINERO")
        expect(materials.getCell("D2").dataValidation.formulae).toEqual(["InitialPackagingGroups"])
        expect(materials.getCell("E2").dataValidation.formulae).toEqual(['"SI,NO"'])
        expect(materials.getCell("F2").dataValidation.formulae).toEqual(['"POR CAJA,POR PALLET"'])
        expect(materials.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
        expect(materials.autoFilter).toBeDefined()
        expect(workbook.worksheets[2].getColumn(1).values).toContain("Opciones reales")
    })
})


type MaterialRow = Partial<Record<keyof typeof INITIAL_PACKAGING_COLUMNS, ExcelJS.CellValue>>
async function combinedExcel(materialRows: MaterialRow[], products = [baseRow({ "Unidades por empaque intermedio": 6, "Nombre del producto (inglés)": "Juice" })]) {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(INITIAL_PRODUCT_SHEET)
    sheet.addRow(HEADERS)
    products.forEach(row => sheet.addRow(HEADERS.map(header => row[header])))
    const materials = workbook.addWorksheet(INITIAL_PACKAGING_SHEET)
    const keys = Object.keys(INITIAL_PACKAGING_COLUMNS) as (keyof typeof INITIAL_PACKAGING_COLUMNS)[]
    materials.addRow(keys.map(key => INITIAL_PACKAGING_COLUMNS[key].header))
    materialRows.forEach(row => materials.addRow(keys.map(key => row[key] ?? null)))
    return await workbook.xlsx.writeBuffer() as unknown as Buffer
}
const material = (materialType = "CAJA", overrides: MaterialRow = {}): MaterialRow => ({ skuCode: "JUGO-PINA", packagingCode: "MP-B", materialType, ...overrides })
describe("carga inicial conjunta", () => {
    let packagings: Record<string, unknown>[]
    let groups: Record<string, unknown>[]
    const transaction = { LOCK: { UPDATE: "UPDATE" }, staged: [] as unknown[], commit: jest.fn(), rollback: jest.fn() }
    beforeEach(() => {
        jest.resetAllMocks()
        transaction.staged = []
        packagings = [
            { id: 1, code: "MP-B", displayName: "Nombre arbitrario", packagingRole: "pallet", isActive: true, unitCost: 2 },
            { id: 2, code: "MP-B2", displayName: "Alternativa", packagingRole: "pallet", isActive: true, unitCost: 3 },
            { id: 3, code: "MP-U", displayName: "Bolsa", packagingRole: "unit", isActive: true, unitCost: 1 },
            { id: 4, code: "MP-U2", displayName: "Otra bolsa", packagingRole: "unit", isActive: true, unitCost: 2 },
            { id: 5, code: "MP-I", displayName: "Intermedio", packagingRole: "intermediate", isActive: true, unitCost: 1 },
        ]
        groups = [{ id: 10, nameKey: "opciones", displayName: "Opciones", isActive: true }]
        ;(Packaging.findAll as jest.Mock).mockImplementation(async () => packagings)
        ;(PackagingGroup.findAll as jest.Mock).mockImplementation(async () => groups)
        ;(Product.findAll as jest.Mock).mockResolvedValue([])
        ;(ProductVariant.findAll as jest.Mock).mockResolvedValue([])
        ;(Presentation.findAll as jest.Mock).mockResolvedValue([{ id: 30, displayLabel: "Bolsa 500 g" }, { id: 31, displayLabel: "Bolsa 2 kg" }])
        ;(SubCategory.findAll as jest.Mock).mockResolvedValue([JUGOS])
        ;(Category.findAll as jest.Mock).mockResolvedValue([FRUTAS])
        ;(Client.findAll as jest.Mock).mockResolvedValue([WALMART])
        let id = 100
        for (const model of [Product, ProductVariant, ProductTranslation, UnitMaterial, IntermediateMaterial, PalletMaterial]) {
            (model.create as jest.Mock).mockImplementation(async (data, options) => {
                expect(options.transaction).toBe(transaction)
                transaction.staged.push(data)
                return { ...data, id: id++ }
            })
        }
        mockTransaction.mockImplementation(async (options, callback) => {
            const run = typeof options === "function" ? options : callback
            try { const result = await run(transaction); transaction.commit(); return result }
            catch (error) { transaction.staged = []; transaction.rollback(); throw error }
        })
    })
    const noWrites = () => {
        for (const model of [Product, ProductTranslation, ProductVariant, UnitMaterial, IntermediateMaterial, PalletMaterial]) expect(model.create).not.toHaveBeenCalled()
    }
    it.each([false, true])("fills the three-sheet template and previews products/materials over HTTP (fallback=%s)", async fallback => {
        const workbook = await loadWorkbookFromBuffer(await productImportService.buildProductImportTemplate())
        const products = workbook.getWorksheet(INITIAL_PRODUCT_SHEET)!
        products.getRow(2).values = Object.keys(PRODUCT_IMPORT_COLUMNS).map(key => {
            const header = PRODUCT_IMPORT_COLUMNS[key as keyof typeof PRODUCT_IMPORT_COLUMNS].header
            return baseRow()[header] ?? null
        })
        const materials = workbook.getWorksheet(INITIAL_PACKAGING_SHEET)!
        materials.getRow(2).values = Object.keys(INITIAL_PACKAGING_COLUMNS).map(key => material()[key as keyof typeof INITIAL_PACKAGING_COLUMNS] ?? null)
        const saved = await writeWorkbookToBuffer(workbook)
        const buffer = fallback ? await prefixSpreadsheetNamespaces(saved) : saved
        expect((await loadWorkbookFromBuffer(buffer)).worksheets).toHaveLength(3)
        const app = buildTestApp("/api/products", productRouter)
        const token = jwt.sign({ sub: 1, type: "staff", permissions: ["products:create"] }, "test-secret")
        const response = await request(app).post("/api/products/bulk-import/preview")
            .set("Authorization", `Bearer ${token}`)
            .attach("file", buffer, { filename: "filled.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
        expect(response.status).toBe(200)
        expect(response.body.data.summary).toMatchObject({ products: 1, variants: 1, pallet: 1, errors: 0 })
        expect(response.body.data.materials[0]).toMatchObject({ quantity: 1, quantityBasis: "per_box" })
        noWrites()
    })
    it("fallback keeps product and packaging formulas visible to business validation", async () => {
        const workbook = await loadWorkbookFromBuffer(await combinedExcel([material()]))
        workbook.getWorksheet(INITIAL_PRODUCT_SHEET)!.getCell("D2").value = { formula: "1+1", result: 2 }
        workbook.getWorksheet(INITIAL_PACKAGING_SHEET)!.getCell("G2").value = { formula: "1+1", result: 2 }
        const preview = await productImportService.previewProductImport(await prefixSpreadsheetNamespaces(await writeWorkbookToBuffer(workbook)))
        expect(preview.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ sheet: INITIAL_PRODUCT_SHEET, key: "errors.packaging_association_import.formula" }),
            expect.objectContaining({ sheet: INITIAL_PACKAGING_SHEET, key: "errors.packaging_association_import.formula" }),
        ]))
        noWrites()
    })
    it("fallback reaches header validation instead of reporting an unreadable Excel", async () => {
        const buffer = await prefixSpreadsheetNamespaces(await buildWorkbookBuffer([{ SKU: "BAD" }], ["SKU"]))
        await expect(productImportService.previewProductImport(buffer)).rejects.toMatchObject({ statusCode: 422, key: "errors.bulk_import_missing_columns" })
        noWrites()
    })
    it("the independent openpyxl fixture reaches business header validation over HTTP", async () => {
        const buffer = await readFile(join(__dirname, "../../../shared/test-utils/fixtures/openpyxl-namespaced.xlsx"))
        const app = buildTestApp("/api/products", productRouter)
        const token = jwt.sign({ sub: 1, type: "staff", permissions: ["products:create"] }, "test-secret")
        const response = await request(app).post("/api/products/bulk-import/preview")
            .set("Authorization", `Bearer ${token}`).set("Accept-Language", "en")
            .attach("file", buffer, { filename: "openpyxl-namespaced.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
        expect(response.status).toBe(422)
        expect(response.body.message).toMatch(/missing.*columns/i)
        expect(response.body.message).not.toMatch(/could not be read/i)
        noWrites()
    })
    it("the actual failing user file reaches preview data/catalog validation over HTTP", async () => {
        const buffer = await readFile(join(__dirname, "../../../shared/test-utils/fixtures/carga_masiva_PRODUCTOS_VARIANTES_EMPAQUES_exceljs_FINAL.xlsx"))
        const app = buildTestApp("/api/products", productRouter)
        const token = jwt.sign({ sub: 1, type: "staff", permissions: ["products:create"] }, "test-secret")
        const response = await request(app).post("/api/products/bulk-import/preview")
            .set("Authorization", `Bearer ${token}`).set("Accept-Language", "en")
            .attach("file", buffer, { filename: "carga_masiva_PRODUCTOS_VARIANTES_EMPAQUES_exceljs_FINAL.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
        expect(response.status).toBe(200)
        expect(response.body.data.summary.errors).toBeGreaterThan(0)
        expect(response.body.data.issues.length).toBeGreaterThan(0)
        expect(response.body.data.issues.every((issue: { sheet: string }) => [INITIAL_PRODUCT_SHEET, INITIAL_PACKAGING_SHEET].includes(issue.sheet))).toBe(true)
        expect(JSON.stringify(response.body)).not.toMatch(/could not be read|TypeError|XLSX.load/)
        noWrites()
    })
    it("fallback preserves legacy first-sheet handling when the functional sheet name is absent", async () => {
        const preview = await productImportService.previewProductImport(await prefixSpreadsheetNamespaces(await buildWorkbookBuffer([baseRow()])))
        expect(preview.summary).toMatchObject({ products: 1, variants: 1, errors: 0 })
        noWrites()
    })
    it("fallback preserves existing row limits", async () => {
        const workbook = await loadWorkbookFromBuffer(await combinedExcel([material()]))
        workbook.getWorksheet(INITIAL_PRODUCT_SHEET)!.getCell("A5002").value = "TOO MANY"
        await expect(productImportService.previewProductImport(await prefixSpreadsheetNamespaces(await writeWorkbookToBuffer(workbook)))).rejects.toMatchObject({ key: "errors.bulk_import_too_many_rows" })
        noWrites()
    })
    async function issue(rows: MaterialRow[], key: string, products?: SheetRow[]) {
        const buffer = await combinedExcel(rows, products)
        const preview = await productImportService.previewProductImport(buffer)
        expect(preview.issues).toEqual(expect.arrayContaining([expect.objectContaining({ sheet: INITIAL_PACKAGING_SHEET, key: `errors.packaging_association_import.${key}` })]))
        await expect(productImportService.bulkImportProducts(buffer)).rejects.toBeInstanceOf(BulkImportError)
        noWrites()
        expect(mockTransaction).not.toHaveBeenCalled()
    }
    it.each([
        ["INDIVIDUAL", "MP-U", "per_unit", 1], ["CAJA", "MP-B", "per_box", 1],
        ["ESQUINERO", "MP-B", "per_pallet", 4], ["TARIMA", "MP-B", "per_pallet", 1],
        ["STRETCH", "MP-B", "per_pallet", 93.3], ["INTERMEDIO", "MP-I", null, null],
    ])("aplica %s explícitamente y permite defaults de catálogo vacíos", async (type, code, basis, quantity) => {
        const buffer = await combinedExcel([material(type, { packagingCode: code })])
        const preview = await productImportService.previewProductImport(buffer)
        expect(preview.summary).toMatchObject({ products: 1, variants: 1, errors: 0 })
        expect(preview.materials[0]).toMatchObject({ materialType: type, quantityBasis: basis, quantity })
        if (type === "CAJA") expect(preview.materials[0].quantityPerPallet).toBe(40)
        noWrites()
        await productImportService.confirmProductImport(buffer, preview.previewHash)
        const association = type === "INDIVIDUAL" ? UnitMaterial : type === "INTERMEDIO" ? IntermediateMaterial : PalletMaterial
        expect(association.create).toHaveBeenCalledWith(expect.objectContaining({ productVariantId: 102 }), { transaction })
        expect(transaction.commit).toHaveBeenCalledTimes(1)
    })
    it("crea todas las asociaciones y dos variantes en la misma transacción", async () => {
        const buffer = await combinedExcel([
            material("INDIVIDUAL", { packagingCode: "MP-U" }), material("INTERMEDIO", { packagingCode: "MP-I" }),
            material(), material("ESQUINERO", { packagingCode: "MP-B2", skuCode: "SECOND" }),
        ], [baseRow({ "Unidades por empaque intermedio": 6 }), baseRow({ "SKU / Número de artículo": "SECOND", "Grupo de producto": "G-1", "Presentación": "Bolsa 2 kg" })])
        const preview = await productImportService.previewProductImport(buffer)
        expect(preview.summary).toEqual({ products: 1, variants: 2, unit: 1, intermediate: 1, pallet: 2, errors: 0, warnings: 0 })
        await productImportService.confirmProductImport(buffer, preview.previewHash)
        expect(Product.create).toHaveBeenCalledTimes(1)
        expect(ProductVariant.create).toHaveBeenCalledTimes(2)
        expect(PalletMaterial.create).toHaveBeenLastCalledWith(expect.objectContaining({ productVariantId: 102, quantityBasis: "per_pallet", quantityValue: 4 }), { transaction })
        expect(mockTransaction).toHaveBeenCalledTimes(1)
    })
    it.each([
        [material("CAJA", { skuCode: "EXISTING" }), "unknown_sku"],
        [material("CAJA", { packagingCode: "MISSING" }), "unknown_packaging"],
        [material("CAJA", { packagingCode: "MP-U" }), "type_role"],
        [material("NOMBRE NO ES TIPO"), "unknown_type"],
        [material("CAJA", { group: "Faltante", isDefault: "SI" }), "unknown_group"],
        [material("CAJA", { group: "Opciones" }), "default_required"],
        [material("CAJA", { group: "Opciones", isDefault: "NO" }), "defaults"],
        [material("CAJA", { group: "Opciones", isDefault: "TRUE" }), "boolean"],
        [material("CAJA", { isDefault: "SI" }), "fixed_default"],
        [material("CAJA", { quantity: 5 }), "type_rule"],
        [material("ESQUINERO", { quantity: 3 }), "type_rule"],
        [material("CAJA", { basis: "POR PALLET" }), "type_rule"],
        [material("CAJA", { basis: "per_box" }), "friendly_basis"],
        [material("OTRO PALETIZACIÓN"), "other_rule_required"],
        [material("OTRO PALETIZACIÓN", { basis: "POR PALLET", quantity: 0 }), "number"],
        [material("OTRO PALETIZACIÓN", { basis: "POR PALLET", quantity: 1.234 }), "pallet_quantity"],
        [material("INTERMEDIO", { packagingCode: "MP-I", quantity: 1 }), "type_rule"],
    ])("rechaza fila inválida %# antes de crear productos", async (row, key) => { await issue([row], key) })
    it("rechaza Packaging inactivo", async () => { packagings[0].isActive = false; await issue([material()], "inactive_packaging") })
    it("rechaza grupo inactivo", async () => { groups[0].isActive = false; await issue([material("CAJA", { group: "Opciones", isDefault: "SI" })], "inactive_group") })
    it("INTERMEDIO requiere la configuración existente de variante", async () => { await issue([material("INTERMEDIO", { packagingCode: "MP-I" })], "intermediate_configuration", [baseRow()]) })
    it("rechaza duplicado SKU + MP sin importar mayúsculas", async () => { await issue([material(), material("CAJA", { skuCode: "jugo-pina", packagingCode: "mp-b" })], "duplicate") })
    it("rechaza múltiples predeterminados", async () => { await issue([material("CAJA", { group: "Opciones", isDefault: "SI" }), material("CAJA", { group: "Opciones", isDefault: "SI", packagingCode: "MP-B2" })], "defaults") })
    it.each(["CAJA", "INDIVIDUAL"])("admite alternativas de %s con un solo predeterminado", async type => {
        const codes = type === "CAJA" ? ["MP-B", "MP-B2"] : ["MP-U", "MP-U2"]
        const buffer = await combinedExcel(codes.map((code, index) => material(type, { packagingCode: code, group: "Opciones", isDefault: index === 0 ? "SI" : "NO" })))
        const preview = await productImportService.previewProductImport(buffer)
        expect(preview.issues).toEqual([])
        await productImportService.confirmProductImport(buffer, preview.previewHash)
        const association = type === "CAJA" ? PalletMaterial : UnitMaterial
        expect(association.create).toHaveBeenCalledTimes(2)
        expect((association.create as jest.Mock).mock.calls.map(([data]) => data.optionGroupId)).toEqual([10, 10])
    })
    it("rechaza cantidades inconsistentes en el mismo grupo", async () => { await issue([material("CAJA", { group: "Opciones", isDefault: "SI" }), material("ESQUINERO", { packagingCode: "MP-B2", group: "Opciones", isDefault: "NO" })], "group_quantity") })
    it("rechaza un mismo grupo entre niveles distintos", async () => { await issue([material("CAJA", { group: "Opciones", isDefault: "SI" }), material("INDIVIDUAL", { packagingCode: "MP-U", group: "Opciones", isDefault: "NO" })], "group_role") })
    it("rechaza defaults contradictorios sin modificar Packaging", async () => {
        Object.assign(packagings[0], { defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4 })
        await issue([material()], "catalog_conflict")
    })
    it("acepta defaults coherentes y OTRO con regla explícita", async () => {
        Object.assign(packagings[0], { defaultQuantityBasis: "per_box", defaultQuantityValue: 1 })
        const preview = await productImportService.previewProductImport(await combinedExcel([material(), material("OTRO PALETIZACIÓN", { packagingCode: "MP-B2", basis: "POR PALLET", quantity: 2.5 })]))
        expect(preview.issues).toEqual([])
        expect(preview.materials[1]).toMatchObject({ quantityBasis: "per_pallet", quantity: 2.5 })
    })
    it("un error en Hoja 1 impide guardar materiales válidos", async () => {
        await expect(productImportService.bulkImportProducts(await combinedExcel([material()], [baseRow({ "Cliente": "Faltante" })]))).rejects.toBeInstanceOf(BulkImportError)
        noWrites()
    })
    it("propaga fallo tardío para rollback de productos, variantes y materiales", async () => {
        (PalletMaterial.create as jest.Mock).mockRejectedValueOnce(new Error("fallo de material"))
        const buffer = await combinedExcel([material("INDIVIDUAL", { packagingCode: "MP-U" }), material()])
        const preview = await productImportService.previewProductImport(buffer)
        await expect(productImportService.confirmProductImport(buffer, preview.previewHash)).rejects.toThrow("fallo de material")
        expect(transaction.rollback).toHaveBeenCalledTimes(1)
        expect(transaction.commit).not.toHaveBeenCalled()
        expect(transaction.staged).toEqual([])
        expect(Product.create).toHaveBeenCalledTimes(1)
        expect(UnitMaterial.create).toHaveBeenCalledTimes(1)
    })
    it("exige nueva validación si cambia el catálogo tras el preview", async () => {
        const buffer = await combinedExcel([material()])
        const preview = await productImportService.previewProductImport(buffer)
        packagings[0].unitCost = 100
        await expect(productImportService.confirmProductImport(buffer, preview.previewHash)).rejects.toMatchObject({ statusCode: 409 })
        noWrites()
    })
    it("admite la segunda hoja vacía sin asociaciones", async () => {
        const buffer = await combinedExcel([])
        const preview = await productImportService.previewProductImport(buffer)
        expect(preview.summary).toMatchObject({ products: 1, variants: 1, errors: 0, pallet: 0 })
        await productImportService.confirmProductImport(buffer, preview.previewHash)
        expect(PalletMaterial.create).not.toHaveBeenCalled()
    })
})
