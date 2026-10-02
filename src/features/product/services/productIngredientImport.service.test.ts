import "reflect-metadata"
import ExcelJS from "exceljs"

// Mismo patrón que productRawMaterialImport.service.test.ts: modelos mockeados, .xlsx reales en
// memoria, sequelize.transaction invocando el callback con una transacción falsa.
jest.mock("../../../database/connection", () => ({
    __esModule: true,
    default: { transaction: jest.fn((callback: (t: unknown) => unknown) => callback({ __fakeTransaction: true })) }
}))
jest.mock("../models/Product.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/ProductIngredient.model", () => ({ __esModule: true, default: { findAll: jest.fn(), bulkCreate: jest.fn() } }))
jest.mock("../../ingredient/models/Ingredient.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))

import sequelize from "../../../database/connection"
jest.mock("../models/ProductVariant.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
import ProductVariant from "../models/ProductVariant.model"
import Product from "../models/Product.model"
import ProductIngredient from "../models/ProductIngredient.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import { productIngredientImportService } from "./productIngredientImport.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockTransaction = sequelize.transaction as unknown as jest.Mock
const mockProductFindAll = Product.findAll as unknown as jest.Mock
const mockRowFindAll = ProductIngredient.findAll as unknown as jest.Mock
const mockRowBulkCreate = ProductIngredient.bulkCreate as unknown as jest.Mock
const mockIngredientFindAll = Ingredient.findAll as unknown as jest.Mock

type SheetRow = Record<string, string | number | undefined>

const HEADERS = ["SKU de una variante del producto", "Código Ingrediente", "Gramos", "Peso de referencia (g)"]

async function buildWorkbookBuffer(rows: SheetRow[], headers: string[] = HEADERS): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Ingredientes")
    sheet.addRow(headers)
    for (const row of rows) {
        sheet.addRow(headers.map(header => row[header]))
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer()
    return arrayBuffer as unknown as Buffer
}

const FIXED = { id: 1, skuCode: "MANGO-DESH", isCustomizable: false }
const MIX = { id: 2, skuCode: "SMOOTHIE-MIX", isCustomizable: true }
const SAL = { id: 10, code: "SAL-001" }
const AZUCAR = { id: 11, code: "AZU-001" }

function row(productSku: string, ingredientCode: string, grams: number | undefined, reference: number | undefined): SheetRow {
    return { "SKU de una variante del producto": productSku, "Código Ingrediente": ingredientCode, "Gramos": grams, "Peso de referencia (g)": reference }
}

async function expectRowIssues(buffer: Buffer, expected: object[]): Promise<void> {
    const error = await productIngredientImportService.bulkImportProductIngredients(buffer).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BulkImportError)
    expect((error as BulkImportError).rowIssues).toEqual(expect.arrayContaining(expected.map(issue => expect.objectContaining(issue))))
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockRowBulkCreate).not.toHaveBeenCalled()
}

describe("productIngredientImportService.bulkImportProductIngredients", () => {
    beforeEach(() => {
        (ProductVariant.findAll as jest.Mock).mockImplementation(async () => (await mockProductFindAll()).map((product: { id: number; skuCode: string }) => ({ skuCode: product.skuCode, productId: product.id, parentProduct: product })))
        mockTransaction.mockClear()
        mockProductFindAll.mockReset().mockResolvedValue([FIXED, MIX])
        mockIngredientFindAll.mockReset().mockResolvedValue([SAL, AZUCAR])
        mockRowFindAll.mockReset().mockResolvedValue([]) // ningún producto tiene ingredientes todavía
        mockRowBulkCreate.mockReset().mockImplementation((rows: object[]) => Promise.resolve(rows))
    })

    it("importa filas de productos fijos y personalizables en una sola transacción, guardando gramos + referencia", async () => {
        const buffer = await buildWorkbookBuffer([
            row("MANGO-DESH", "SAL-001", 40, 2000),
            row("mango-desh", "azu-001", 100, 2000), // códigos sin distinguir mayúsculas
            row("SMOOTHIE-MIX", "AZU-001", 12.5, 500),
        ])

        const result = await productIngredientImportService.bulkImportProductIngredients(buffer)

        expect(result).toHaveLength(3)
        expect(mockTransaction).toHaveBeenCalledTimes(1)
        expect(mockRowBulkCreate).toHaveBeenCalledWith(
            [
                { productId: 1, ingredientId: 10, grams: 40, referenceNetWeightGrams: 2000 },
                { productId: 1, ingredientId: 11, grams: 100, referenceNetWeightGrams: 2000 },
                { productId: 2, ingredientId: 11, grams: 12.5, referenceNetWeightGrams: 500 },
            ],
            { transaction: { __fakeTransaction: true } }
        )
    })

    it("dos SKUs del mismo producto comparten ingredientes y detectan duplicados", async () => {
        (ProductVariant.findAll as jest.Mock).mockResolvedValue([
            { skuCode: FIXED.skuCode, parentProduct: FIXED }, { skuCode: "SECOND", parentProduct: FIXED },
        ])
        await productIngredientImportService.bulkImportProductIngredients(await buildWorkbookBuffer([row(FIXED.skuCode, SAL.code, 10, 500), row("SECOND", AZUCAR.code, 20, 500)]))
        expect(mockRowBulkCreate.mock.calls[0][0].map((line: { productId: number }) => line.productId)).toEqual([1, 1])
        mockTransaction.mockClear()
        mockRowBulkCreate.mockClear()
        await expectRowIssues(await buildWorkbookBuffer([row(FIXED.skuCode, SAL.code, 10, 500), row("SECOND", SAL.code, 10, 500)]), [{ row: 3, key: "errors.bulk_import_duplicate_ingredient_in_product" }])
    })

    it("rechaza un código de producto desconocido", async () => {
        await expectRowIssues(await buildWorkbookBuffer([row("NOPE", "SAL-001", 40, 2000)]), [
            { row: 2, field: "productId", key: "errors.bulk_import_unknown_product_sku" }
        ])
    })

    it("rechaza un código de ingrediente desconocido (o inactivo -- solo se cargan los activos)", async () => {
        await expectRowIssues(await buildWorkbookBuffer([row("MANGO-DESH", "PIM-001", 5, 2000)]), [
            { row: 2, field: "ingredientId", key: "errors.bulk_import_unknown_ingredient_code", params: { code: "PIM-001" } }
        ])
        expect(mockIngredientFindAll).toHaveBeenCalledWith({ where: { isActive: true } })
    })

    it("rechaza gramos > peso de referencia", async () => {
        await expectRowIssues(await buildWorkbookBuffer([row("MANGO-DESH", "SAL-001", 2500, 2000)]), [
            { row: 2, field: "grams", key: "errors.product_ingredient_grams_exceed_reference" }
        ])
    })

    it("rechaza gramos o referencia vacíos / ≤ 0", async () => {
        await expectRowIssues(
            await buildWorkbookBuffer([row("MANGO-DESH", "SAL-001", undefined, 2000), row("SMOOTHIE-MIX", "SAL-001", 10, 0)]),
            [{ row: 2, field: "grams" }, { row: 3, field: "referenceNetWeightGrams" }]
        )
    })

    it("rechaza el mismo ingrediente repetido dentro de un producto", async () => {
        await expectRowIssues(
            await buildWorkbookBuffer([row("MANGO-DESH", "SAL-001", 40, 2000), row("MANGO-DESH", "SAL-001", 20, 2000)]),
            [{ row: 3, field: "ingredientId", key: "errors.bulk_import_duplicate_ingredient_in_product", params: { productSku: "MANGO-DESH", code: "SAL-001" } }]
        )
    })

    it("rechaza (create-only) un producto que ya tiene ingredientes activos", async () => {
        mockRowFindAll.mockResolvedValue([{ productId: FIXED.id }])

        await expectRowIssues(await buildWorkbookBuffer([row("MANGO-DESH", "SAL-001", 40, 2000)]), [
            { row: 2, field: "productId", key: "errors.bulk_import_product_ingredients_already_exist" }
        ])
    })

    it("no crea NADA si una sola fila de otro producto falla (todo o nada)", async () => {
        await expectRowIssues(
            await buildWorkbookBuffer([row("MANGO-DESH", "SAL-001", 40, 2000), row("SMOOTHIE-MIX", "NOPE", 10, 500)]),
            [{ row: 3, key: "errors.bulk_import_unknown_ingredient_code" }]
        )
    })

    it("rechaza el archivo si le falta una columna requerida", async () => {
        const buffer = await buildWorkbookBuffer([{ "SKU de una variante del producto": "MANGO-DESH", "Código Ingrediente": "SAL-001", "Gramos": 40 }], HEADERS.slice(0, 3))

        await expect(productIngredientImportService.bulkImportProductIngredients(buffer)).rejects.toMatchObject({
            key: "errors.bulk_import_missing_columns",
            params: { columns: "Peso de referencia (g)" }
        })
    })

    it("rechaza un archivo sin filas", async () => {
        await expect(
            productIngredientImportService.bulkImportProductIngredients(await buildWorkbookBuffer([]))
        ).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
    })
})

describe("productIngredientImportService.buildProductIngredientImportTemplate", () => {
    beforeEach(() => {
        mockProductFindAll.mockReset().mockResolvedValue([FIXED, MIX])
        mockIngredientFindAll.mockReset().mockResolvedValue([SAL, AZUCAR])
        mockRowFindAll.mockReset().mockResolvedValue([])
        mockRowBulkCreate.mockReset().mockImplementation((rows: object[]) => Promise.resolve(rows))
    })

    it("genera la plantilla con los 4 encabezados y filas de ejemplo que pasan el importador real (round-trip)", async () => {
        const templateBuffer = await productIngredientImportService.buildProductIngredientImportTemplate()

        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo choque de tipos de exceljs documentado en shared/utils/excelImport.util.ts
        await workbook.xlsx.load(templateBuffer as any)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Ingredientes", "Instrucciones"])
        expect((workbook.worksheets[0].getRow(1).values as unknown[]).slice(1)).toEqual(HEADERS)

        const result = await productIngredientImportService.bulkImportProductIngredients(templateBuffer)
        expect(result).toHaveLength(3)
    })
})
