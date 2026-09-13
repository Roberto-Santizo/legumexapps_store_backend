import "reflect-metadata"
import ExcelJS from "exceljs"

// Mocks manuales de los modelos -- mismo patrón que packaging.service.test.ts/ingredient.service.test.ts:
// solo se mockean los métodos de Sequelize que la función realmente llama, todo el parseo/mapeo
// de Excel corre real contra archivos .xlsx armados de verdad en cada test. `sequelize.transaction`
// se mockea para simplemente invocar el callback con un objeto de transacción falso -- no hay una
// BD real en este entorno de pruebas, así que lo único que se prueba de la transacción es que
// EXISTE (se llama solo cuando la validación completa pasó) y que a cada `create`/`bulkCreate`
// dentro de ella se le pasa la misma `transaction`.
jest.mock("../../../database/connection", () => ({
    __esModule: true,
    default: { transaction: jest.fn((callback: (t: unknown) => unknown) => callback({ __fakeTransaction: true })) }
}))
jest.mock("../models/Product.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../presentation/models/Presentation.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../packaging/models/Packaging.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/ProductVariant.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/ProductVariantUnitMaterial.model", () => ({ __esModule: true, default: { bulkCreate: jest.fn() } }))
jest.mock("../models/ProductVariantPalletMaterial.model", () => ({ __esModule: true, default: { bulkCreate: jest.fn() } }))

import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
import Presentation from "../../presentation/models/Presentation.model"
import Packaging from "../../packaging/models/Packaging.model"
import ProductVariant from "../models/ProductVariant.model"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { productVariantImportService } from "./productVariantImport.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const mockTransaction = sequelize.transaction as unknown as jest.Mock
const mockProductFindAll = Product.findAll as unknown as jest.Mock
const mockPresentationFindAll = Presentation.findAll as unknown as jest.Mock
const mockPackagingFindAll = Packaging.findAll as unknown as jest.Mock
const mockVariantFindAll = ProductVariant.findAll as unknown as jest.Mock
const mockVariantCreate = ProductVariant.create as unknown as jest.Mock
const mockUnitMaterialBulkCreate = ProductVariantUnitMaterial.bulkCreate as unknown as jest.Mock
const mockPalletMaterialBulkCreate = ProductVariantPalletMaterial.bulkCreate as unknown as jest.Mock

type SheetRow = Record<string, string | number | undefined>

async function buildWorkbookBuffer(rows: SheetRow[], headers: string[] = HEADERS): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("SKUs")
    sheet.addRow(headers)
    for (const row of rows) {
        sheet.addRow(headers.map(header => row[header]))
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer()
    return arrayBuffer as unknown as Buffer
}

const HEADERS = ["Código Producto", "Código SKU", "Presentación", "Cajas por palet", "Bolsas por caja", "Código Material", "Cantidad"]

const PRODUCT = { id: 1, codigo: "JUGO-PINA-WM", displayName: "Better Goods Pineapple Juice" }
const PRESENTATION = { id: 2, displayLabel: "Botella 12 oz (0.75 lb)" }
const TAPA = { id: 10, code: "T-ME-AB010", displayName: "Tapa", packagingRole: "unit" }
const ENVASE = { id: 11, code: "T-ME-AB020", displayName: "Envase", packagingRole: "unit" }
const CAJA = { id: 12, code: "T-ME-AB158", displayName: "Caja", packagingRole: "pallet" }
const BOLSA_MASTER = { id: 13, code: "BOL-002", displayName: "Bolsa grande", packagingRole: "intermediate" }

function baseRow(overrides: Partial<SheetRow> = {}): SheetRow {
    return {
        "Código Producto": PRODUCT.codigo,
        "Código SKU": "PAB1310105",
        "Presentación": PRESENTATION.displayLabel,
        "Cajas por palet": 385,
        "Bolsas por caja": 6,
        "Código Material": TAPA.code,
        "Cantidad": 1,
        ...overrides,
    }
}

describe("productVariantImportService.bulkImportProductVariants", () => {
    beforeEach(() => {
        mockTransaction.mockClear()
        mockProductFindAll.mockReset().mockResolvedValue([PRODUCT])
        mockPresentationFindAll.mockReset().mockResolvedValue([PRESENTATION])
        mockPackagingFindAll.mockReset().mockResolvedValue([TAPA, ENVASE, CAJA, BOLSA_MASTER])
        mockVariantFindAll.mockReset().mockResolvedValue([]) // sin skuCode existentes en la BD
        mockVariantCreate.mockReset().mockImplementation((data: object) => Promise.resolve({ id: 100, ...data }))
        mockUnitMaterialBulkCreate.mockReset().mockResolvedValue([])
        mockPalletMaterialBulkCreate.mockReset().mockResolvedValue([])
    })

    it("importa un SKU completo (empaque individual + material de palet) dentro de UNA transacción", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código Material": ENVASE.code, "Cantidad": 1 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ])

        const result = await productVariantImportService.bulkImportProductVariants(buffer)

        expect(result).toHaveLength(1)
        expect(mockTransaction).toHaveBeenCalledTimes(1)
        expect(mockVariantCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                productId: PRODUCT.id,
                presentationId: PRESENTATION.id,
                skuCode: "PAB1310105",
                boxesPerPallet: 385,
                bagsPerBox: 6,
                intermediatePackagingId: null,
                unitsPerIntermediatePackage: null,
            }),
            { transaction: { __fakeTransaction: true } }
        )
        expect(mockUnitMaterialBulkCreate).toHaveBeenCalledWith(
            [
                { productVariantId: 100, packagingId: TAPA.id, quantityPerUnit: 1 },
                { productVariantId: 100, packagingId: ENVASE.id, quantityPerUnit: 1 },
            ],
            { transaction: { __fakeTransaction: true } }
        )
        expect(mockPalletMaterialBulkCreate).toHaveBeenCalledWith(
            [{ productVariantId: 100, packagingId: CAJA.id, quantityValue: 385 }],
            { transaction: { __fakeTransaction: true } }
        )
    })

    it("dispatcha una fila de rol \"intermediate\" a intermediatePackagingId/unitsPerIntermediatePackage, no a una tabla de materiales", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código Material": BOLSA_MASTER.code, "Cantidad": 50 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ])

        await productVariantImportService.bulkImportProductVariants(buffer)

        expect(mockVariantCreate).toHaveBeenCalledWith(
            expect.objectContaining({ intermediatePackagingId: BOLSA_MASTER.id, unitsPerIntermediatePackage: 50 }),
            expect.anything()
        )
        // La bolsa grande no debe colarse como si fuera un material unit/pallet.
        expect(mockUnitMaterialBulkCreate).toHaveBeenCalledWith(
            [{ productVariantId: 100, packagingId: TAPA.id, quantityPerUnit: 1 }],
            expect.anything()
        )
    })

    it("rechaza el archivo COMPLETO si un Código Producto no existe -- no se abre ninguna transacción, no se escribe nada", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Producto": "NO-EXISTE" }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Código Producto": "NO-EXISTE" }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
            rowIssues: expect.arrayContaining([expect.objectContaining({ field: "productId", key: "errors.bulk_import_unknown_product_codigo" })])
        })
        expect(mockTransaction).not.toHaveBeenCalled()
        expect(mockVariantCreate).not.toHaveBeenCalled()
    })

    it("rechaza el archivo si una Presentación no existe", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Presentación": "No existe" }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Presentación": "No existe" }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
            rowIssues: expect.arrayContaining([expect.objectContaining({ field: "presentationId", key: "errors.bulk_import_presentation_not_found" })])
        })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("rechaza el archivo si un Código Material no existe en el catálogo de Empaques", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": "NO-EXISTE" }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
            rowIssues: expect.arrayContaining([expect.objectContaining({ field: "packagingId", key: "errors.bulk_import_unknown_packaging_code" })])
        })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("rechaza un SKU con más de una fila de rol \"empaque intermedio\"", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código Material": BOLSA_MASTER.code, "Cantidad": 50 }),
            baseRow({ "Código Material": BOLSA_MASTER.code, "Cantidad": 25 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ key: "errors.bulk_import_multiple_intermediate_rows", params: { skuCode: "PAB1310105" } })]
        })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("rechaza un SKU sin ningún material de rol \"empaque individual\"", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ key: "errors.bulk_import_sku_missing_unit_materials" })]
        })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("rechaza un SKU sin ningún material de rol \"material de paletización\"", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ key: "errors.bulk_import_sku_missing_pallet_materials" })]
        })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("rechaza el mismo material repetido dos veces para un mismo SKU", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código Material": TAPA.code, "Cantidad": 2 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ key: "errors.bulk_import_duplicate_material_in_sku" })]
        })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("rechaza si las columnas repetidas del mismo SKU (Cajas por palet, etc.) traen valores distintos entre filas", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1, "Cajas por palet": 385 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Cajas por palet": 400 }), // contradice la fila de arriba
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ key: "errors.bulk_import_sku_inconsistent_fields" })]
        })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("rechaza un skuCode que ya existe en la BD (activo o no) -- este importador solo crea, no actualiza", async () => {
        mockVariantFindAll.mockResolvedValue([{ skuCode: "PAB1310105" }])
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
            rowIssues: [expect.objectContaining({ key: "errors.product_variant_skucode_already_exists" })]
        })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("rechaza una fila sin Cantidad (columna requerida, nunca se infiere)", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": undefined }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("excluye correctamente un SKU sin \"Cajas por palet\" en el sentido de que la columna es requerida -- fila incompleta se rechaza, no se asume nada", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1, "Cajas por palet": undefined }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Cajas por palet": undefined }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("todo o nada POR ARCHIVO: un solo SKU inválido entre varios rechaza el archivo completo, ninguno se crea", async () => {
        const buffer = await buildWorkbookBuffer([
            // SKU 1: válido
            baseRow({ "Código SKU": "PAB1310105", "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código SKU": "PAB1310105", "Código Material": CAJA.code, "Cantidad": 385 }),
            // SKU 2: inválido (material desconocido)
            baseRow({ "Código SKU": "PAB9999999", "Código Material": "NO-EXISTE", "Cantidad": 1 }),
        ])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(mockTransaction).not.toHaveBeenCalled()
        expect(mockVariantCreate).not.toHaveBeenCalled()
    })

    it("ignora filas completamente vacías sin tratarlas como error", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
            {},
        ])

        const result = await productVariantImportService.bulkImportProductVariants(buffer)

        expect(result).toHaveLength(1)
    })

    it("rechaza el archivo si le falta una columna requerida", async () => {
        const buffer = await buildWorkbookBuffer(
            [{ "Código Producto": PRODUCT.codigo, "Código SKU": "PAB1310105" }],
            ["Código Producto", "Código SKU"]
        )

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_missing_columns" })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    it("rechaza un archivo sin filas de datos (solo encabezado)", async () => {
        const buffer = await buildWorkbookBuffer([])

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
    })
})

describe("productVariantImportService.buildProductVariantImportTemplate", () => {
    it("genera un .xlsx válido que bulkImportProductVariants puede releer sin errores (round-trip)", async () => {
        mockProductFindAll.mockResolvedValue([PRODUCT, { id: 2, codigo: "DEMO-PROD", displayName: "Demo" }])
        mockPresentationFindAll.mockResolvedValue([PRESENTATION, { id: 3, displayLabel: "Demo 2kg" }])
        mockPackagingFindAll.mockResolvedValue([
            TAPA, ENVASE, CAJA,
            { id: 20, code: "BOL-001", displayName: "Bolsa plástica 2kg", packagingRole: "unit" },
            { id: 21, code: "BOL-002", displayName: "Bolsa grande 50 unidades", packagingRole: "intermediate" },
            { id: 22, code: "CAJ-001", displayName: "Caja corrugada master", packagingRole: "pallet" },
        ])
        mockVariantFindAll.mockResolvedValue([])
        mockVariantCreate.mockImplementation((data: object) => Promise.resolve({ id: 200, ...data }))

        const templateBuffer = await productVariantImportService.buildProductVariantImportTemplate()

        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo choque de tipos de exceljs documentado en productVariantImport.service.ts
        await workbook.xlsx.load(templateBuffer as any)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["SKUs", "Instrucciones"])

        const result = await productVariantImportService.bulkImportProductVariants(templateBuffer)
        expect(result.length).toBeGreaterThan(0)
    })
})
