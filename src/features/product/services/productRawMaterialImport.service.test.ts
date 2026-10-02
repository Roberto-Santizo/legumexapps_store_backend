import "reflect-metadata"
import ExcelJS from "exceljs"

// Modelos mockeados, archivos .xlsx reales
// armados en memoria, y sequelize.transaction invocando el callback con una transacción falsa.
jest.mock("../../../database/connection", () => ({
    __esModule: true,
    default: { transaction: jest.fn((callback: (t: unknown) => unknown) => callback({ __fakeTransaction: true })) }
}))
jest.mock("../models/Product.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/ProductRawMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), bulkCreate: jest.fn() } }))
jest.mock("../../rawMaterial/models/RawMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))

import sequelize from "../../../database/connection"
jest.mock("../models/ProductVariant.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
import ProductVariant from "../models/ProductVariant.model"
import Product from "../models/Product.model"
import ProductRawMaterial from "../models/ProductRawMaterial.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import { productRawMaterialImportService } from "./productRawMaterialImport.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockTransaction = sequelize.transaction as unknown as jest.Mock
const mockProductFindAll = Product.findAll as unknown as jest.Mock
const mockRecipeFindAll = ProductRawMaterial.findAll as unknown as jest.Mock
const mockRecipeBulkCreate = ProductRawMaterial.bulkCreate as unknown as jest.Mock
const mockRawMaterialFindAll = RawMaterial.findAll as unknown as jest.Mock

type SheetRow = Record<string, string | number | undefined>

const HEADERS = ["SKU de una variante del producto", "Código Materia Prima", "Porcentaje", "% mínimo", "% máximo"]

async function buildWorkbookBuffer(rows: SheetRow[], headers: string[] = HEADERS): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Recetas")
    sheet.addRow(headers)
    for (const row of rows) {
        sheet.addRow(headers.map(header => row[header]))
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer()
    return arrayBuffer as unknown as Buffer
}

const FIXED = { id: 1, skuCode: "JUGO-PINA", isCustomizable: false, isOrganic: false }
const MIX = { id: 2, skuCode: "SMOOTHIE", isCustomizable: true, isOrganic: false }
const ORGANIC_FIXED = { id: 3, skuCode: "JUGO-ORG", isCustomizable: false, isOrganic: true }

const PINA = { id: 10, code: "MP-PINA", isMixable: true, isOrganic: false, ingredientType: "fruit" }
const AGUA = { id: 11, code: "MP-AGUA", isMixable: false, isOrganic: false, ingredientType: "other" }
const FRESA = { id: 12, code: "MP-FRESA", isMixable: true, isOrganic: false, ingredientType: "fruit" }
const BANANO = { id: 13, code: "MP-BANANO", isMixable: true, isOrganic: false, ingredientType: "fruit" }
const PINA_ORG = { id: 14, code: "MP-PINA-ORG", isMixable: true, isOrganic: true, ingredientType: "fruit" }

function fixedRow(rawMaterialCode: string, percentage: number | undefined, overrides: Partial<SheetRow> = {}): SheetRow {
    return { "SKU de una variante del producto": FIXED.skuCode, "Código Materia Prima": rawMaterialCode, "Porcentaje": percentage, ...overrides }
}

function mixRow(rawMaterialCode: string, overrides: Partial<SheetRow> = {}): SheetRow {
    return { "SKU de una variante del producto": MIX.skuCode, "Código Materia Prima": rawMaterialCode, ...overrides }
}

async function expectRowIssues(buffer: Buffer, expected: object[]): Promise<BulkImportError> {
    const error = await productRawMaterialImportService.bulkImportProductRawMaterials(buffer).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BulkImportError)
    expect((error as BulkImportError).rowIssues).toEqual(expect.arrayContaining(expected.map(issue => expect.objectContaining(issue))))
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockRecipeBulkCreate).not.toHaveBeenCalled()
    return error as BulkImportError
}

describe("productRawMaterialImportService.bulkImportProductRawMaterials", () => {
    beforeEach(() => {
        (ProductVariant.findAll as jest.Mock).mockImplementation(async () => (await mockProductFindAll()).map((product: { id: number; skuCode: string }) => ({ skuCode: product.skuCode, productId: product.id, parentProduct: product })))
        mockTransaction.mockClear()
        mockProductFindAll.mockReset().mockResolvedValue([FIXED, MIX, ORGANIC_FIXED])
        mockRawMaterialFindAll.mockReset().mockResolvedValue([PINA, AGUA, FRESA, BANANO, PINA_ORG])
        mockRecipeFindAll.mockReset().mockResolvedValue([]) // ningún producto tiene receta todavía
        mockRecipeBulkCreate.mockReset().mockImplementation((rows: object[]) => Promise.resolve(rows))
    })

    it("dos SKUs del mismo producto comparten una sola receta", async () => {
        (ProductVariant.findAll as jest.Mock).mockResolvedValue([
            { skuCode: FIXED.skuCode, parentProduct: FIXED }, { skuCode: "SECOND", parentProduct: FIXED },
        ])
        await productRawMaterialImportService.bulkImportProductRawMaterials(await buildWorkbookBuffer([
            fixedRow(PINA.code, 60), fixedRow(AGUA.code, 40, { "SKU de una variante del producto": "SECOND" }),
        ]))
        expect(mockRecipeBulkCreate.mock.calls[0][0].map((line: { productId: number }) => line.productId)).toEqual([1, 1])
        expect(ProductVariant.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true }, include: [expect.objectContaining({ required: true, where: { isActive: true } })] }))
    })
    it("rechaza la receta repetida usando otro SKU del mismo producto", async () => {
        (ProductVariant.findAll as jest.Mock).mockResolvedValue([
            { skuCode: FIXED.skuCode, parentProduct: FIXED }, { skuCode: "SECOND", parentProduct: FIXED },
        ])
        await expectRowIssues(await buildWorkbookBuffer([fixedRow(PINA.code, 100), fixedRow(PINA.code, 100, { "SKU de una variante del producto": "SECOND" })]), [{ row: 3, key: "errors.bulk_import_duplicate_raw_material_in_product" }])
    })

    describe("receta fija", () => {
        it("importa una receta que suma 100 dentro de UNA transacción, sin rangos", async () => {
            const buffer = await buildWorkbookBuffer([fixedRow(PINA.code, 90), fixedRow(AGUA.code, 10)])

            const result = await productRawMaterialImportService.bulkImportProductRawMaterials(buffer)

            expect(result).toHaveLength(2)
            expect(mockTransaction).toHaveBeenCalledTimes(1)
            expect(mockRecipeBulkCreate).toHaveBeenCalledWith(
                [
                    { productId: FIXED.id, rawMaterialId: PINA.id, percentage: 90, minPercentage: null, maxPercentage: null },
                    { productId: FIXED.id, rawMaterialId: AGUA.id, percentage: 10, minPercentage: null, maxPercentage: null },
                ],
                { transaction: { __fakeTransaction: true } }
            )
        })

        it("acepta un total dentro de la tolerancia de ±0.5", async () => {
            const buffer = await buildWorkbookBuffer([fixedRow(PINA.code, 66.7), fixedRow(AGUA.code, 33.4)])

            await expect(productRawMaterialImportService.bulkImportProductRawMaterials(buffer)).resolves.toHaveLength(2)
        })

        it("rechaza una receta que no suma 100", async () => {
            const buffer = await buildWorkbookBuffer([fixedRow(PINA.code, 80), fixedRow(AGUA.code, 10)])

            await expectRowIssues(buffer, [
                { row: 2, key: "errors.bulk_import_fixed_recipe_total_invalid", params: { productSku: FIXED.skuCode, total: 90 } },
            ])
        })

        it("exige Porcentaje en cada fila", async () => {
            const buffer = await buildWorkbookBuffer([fixedRow(PINA.code, 100), fixedRow(AGUA.code, undefined)])

            const error = await expectRowIssues(buffer, [
                { row: 3, field: "percentage", key: "errors.product_raw_material_percentage_required" },
            ])
            // Un producto con una fila inválida no suma además un error engañoso de "no suma 100".
            expect(error.rowIssues.map(issue => issue.key)).not.toContain("errors.bulk_import_fixed_recipe_total_invalid")
        })

        it("rechaza % mínimo / % máximo en una receta fija (columna equivocada para el tipo)", async () => {
            const buffer = await buildWorkbookBuffer([fixedRow(PINA.code, 100, { "% mínimo": 10 })])

            await expectRowIssues(buffer, [{ row: 2, field: "minPercentage", key: "errors.bulk_import_min_max_on_fixed_recipe" }])
        })

        it("rechaza un Porcentaje fuera de rango (> 100) con el schema del formulario manual", async () => {
            const buffer = await buildWorkbookBuffer([fixedRow(PINA.code, 150)])

            await expectRowIssues(buffer, [{ row: 2, field: "percentage" }])
        })
    })

    describe("receta personalizable", () => {
        it("importa el pool con rangos opcionales y sin porcentaje fijo", async () => {
            const buffer = await buildWorkbookBuffer([
                mixRow(FRESA.code, { "% mínimo": 20, "% máximo": 80 }),
                mixRow(BANANO.code),
            ])

            await productRawMaterialImportService.bulkImportProductRawMaterials(buffer)

            expect(mockRecipeBulkCreate).toHaveBeenCalledWith(
                [
                    { productId: MIX.id, rawMaterialId: FRESA.id, percentage: null, minPercentage: 20, maxPercentage: 80 },
                    { productId: MIX.id, rawMaterialId: BANANO.id, percentage: null, minPercentage: null, maxPercentage: null },
                ],
                { transaction: { __fakeTransaction: true } }
            )
        })

        it("rechaza Porcentaje en una receta personalizable (columna equivocada para el tipo)", async () => {
            const buffer = await buildWorkbookBuffer([mixRow(FRESA.code, { "Porcentaje": 50 })])

            await expectRowIssues(buffer, [{ row: 2, field: "percentage", key: "errors.bulk_import_percentage_on_customizable_recipe" }])
        })

        it("rechaza % mínimo mayor que % máximo", async () => {
            const buffer = await buildWorkbookBuffer([mixRow(FRESA.code, { "% mínimo": 70, "% máximo": 30 })])

            await expectRowIssues(buffer, [
                { row: 2, field: "minPercentage", key: "errors.bulk_import_min_greater_than_max", params: { min: 70, max: 30 } },
            ])
        })

        it("rechaza una materia prima que no es mezclable", async () => {
            const buffer = await buildWorkbookBuffer([mixRow(FRESA.code), mixRow(AGUA.code)])

            await expectRowIssues(buffer, [{ row: 3, field: "rawMaterialId", key: "errors.raw_material_not_mixable" }])
        })

        it("rechaza un pool cuyos mínimos suman más de 100", async () => {
            const buffer = await buildWorkbookBuffer([
                mixRow(FRESA.code, { "% mínimo": 60 }),
                mixRow(BANANO.code, { "% mínimo": 50 }),
            ])

            await expectRowIssues(buffer, [
                { row: 2, key: "errors.bulk_import_customizable_pool_cannot_reach_100", params: { productSku: MIX.skuCode, minTotal: 110, maxTotal: 200 } },
            ])
        })

        it("rechaza un pool cuyos máximos no llegan a 100", async () => {
            const buffer = await buildWorkbookBuffer([
                mixRow(FRESA.code, { "% máximo": 40 }),
                mixRow(BANANO.code, { "% máximo": 40 }),
            ])

            await expectRowIssues(buffer, [
                { row: 2, key: "errors.bulk_import_customizable_pool_cannot_reach_100", params: { productSku: MIX.skuCode, minTotal: 0, maxTotal: 80 } },
            ])
        })
    })

    it("rechaza una materia prima no orgánica (y no de tipo \"otro\") en un producto orgánico; \"otro\" sí se permite", async () => {
        const buffer = await buildWorkbookBuffer([
            { "SKU de una variante del producto": ORGANIC_FIXED.skuCode, "Código Materia Prima": PINA.code, "Porcentaje": 50 },
            { "SKU de una variante del producto": ORGANIC_FIXED.skuCode, "Código Materia Prima": AGUA.code, "Porcentaje": 50 },
        ])

        const error = await expectRowIssues(buffer, [
            { row: 2, field: "rawMaterialId", key: "errors.raw_material_not_organic_compatible" },
        ])
        expect(error.rowIssues.filter(issue => issue.row === 3)).toEqual([])
    })

    it("rechaza la misma materia prima dos veces en la receta de un producto", async () => {
        const buffer = await buildWorkbookBuffer([fixedRow(PINA.code, 50), fixedRow("mp-pina", 50)])

        await expectRowIssues(buffer, [
            { row: 3, field: "rawMaterialId", key: "errors.bulk_import_duplicate_raw_material_in_product" },
        ])
    })

    it("create-only: rechaza el grupo de un producto que ya tiene receta activa", async () => {
        mockRecipeFindAll.mockResolvedValue([{ productId: FIXED.id }])
        const buffer = await buildWorkbookBuffer([fixedRow(PINA.code, 100)])

        await expectRowIssues(buffer, [
            { row: 2, field: "productId", key: "errors.bulk_import_product_recipe_already_exists", params: { productSku: FIXED.skuCode } },
        ])
        expect(mockRecipeFindAll).toHaveBeenCalledWith({ where: { isActive: true }, attributes: ["productId"] })
    })

    it("rechaza un código de producto o de materia prima inexistente", async () => {
        const buffer = await buildWorkbookBuffer([
            fixedRow(PINA.code, 100, { "SKU de una variante del producto": "NO-EXISTE" }),
            fixedRow("MP-NADA", 100),
        ])

        await expectRowIssues(buffer, [
            { row: 2, field: "productId", key: "errors.bulk_import_unknown_product_sku" },
            { row: 3, field: "rawMaterialId", key: "errors.bulk_import_unknown_raw_material_code" },
        ])
    })

    it("todo-o-nada: un producto válido junto a uno inválido no crea ninguna fila", async () => {
        const buffer = await buildWorkbookBuffer([
            fixedRow(PINA.code, 100),
            mixRow(FRESA.code, { "Porcentaje": 100 }),
        ])

        await expectRowIssues(buffer, [{ row: 3, key: "errors.bulk_import_percentage_on_customizable_recipe" }])
    })

    it("rechaza un archivo sin las columnas obligatorias", async () => {
        const buffer = await buildWorkbookBuffer([{ "SKU de una variante del producto": FIXED.skuCode }], ["SKU de una variante del producto"])

        await expect(productRawMaterialImportService.bulkImportProductRawMaterials(buffer)).rejects.toMatchObject({
            key: "errors.bulk_import_missing_columns",
        })
    })
})

describe("productRawMaterialImportService.buildProductRawMaterialImportTemplate", () => {
    it("la plantilla descargable trae los encabezados que el importador reconoce", async () => {
        const buffer = await productRawMaterialImportService.buildProductRawMaterialImportTemplate()
        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo cast que excelImport.util.ts
        await workbook.xlsx.load(buffer as any)
        const headerRow = workbook.worksheets[0].getRow(1).values as unknown[]

        expect(headerRow.filter(Boolean)).toEqual(HEADERS)
    })
})
