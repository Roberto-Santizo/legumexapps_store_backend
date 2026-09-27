import "reflect-metadata"
import ExcelJS from "exceljs"

// Mocks manuales de los modelos -- mismo patrón que packaging.service.test.ts/rawMaterial.service.test.ts:
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
jest.mock("../models/ProductVariantIntermediateMaterial.model", () => ({ __esModule: true, default: { bulkCreate: jest.fn() } }))
jest.mock("../models/ProductRawMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))

import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
import Presentation from "../../presentation/models/Presentation.model"
import Packaging from "../../packaging/models/Packaging.model"
import ProductVariant from "../models/ProductVariant.model"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import ProductVariantIntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import ProductRawMaterial from "../models/ProductRawMaterial.model"
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
const mockIntermediateMaterialBulkCreate = ProductVariantIntermediateMaterial.bulkCreate as unknown as jest.Mock
const mockRecipeFindAll = ProductRawMaterial.findAll as unknown as jest.Mock

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

const HEADERS = ["Código Producto", "Presentación", "Cajas por palet", "Bolsas por caja", "Código Material", "Cantidad"]
// Plantilla con las dos columnas opcionales de grupos de opciones (2026-09-25).
const GROUP_HEADERS = [...HEADERS, "Grupo", "Predeterminado"]

const PRODUCT = { id: 1, codigo: "JUGO-PINA-WM", displayName: "Better Goods Pineapple Juice", isCustomizable: false }
// Receta fija completa (suma 100) de PRODUCT -- sin ella, desde 2026-09-25 sus SKUs se rechazan.
const COMPLETE_RECIPE = [{ productId: PRODUCT.id, percentage: "90.00" }, { productId: PRODUCT.id, percentage: "10.00" }]
const PRESENTATION = { id: 2, displayLabel: "Botella 12 oz (0.75 lb)" }
const TAPA = { id: 10, code: "T-ME-AB010", displayName: "Tapa", packagingRole: "unit" }
const ENVASE = { id: 11, code: "T-ME-AB020", displayName: "Envase", packagingRole: "unit" }
const CAJA = { id: 12, code: "T-ME-AB158", displayName: "Caja", packagingRole: "pallet" }
const BOLSA_MASTER = { id: 13, code: "BOL-002", displayName: "Bolsa grande", packagingRole: "intermediate" }
const SACO_REFORZADO = { id: 14, code: "BOL-003", displayName: "Saco reforzado", packagingRole: "intermediate" }
const BOLSA_LOGO = { id: 15, code: "BOL-LOGO", displayName: "Bolsa con logo", packagingRole: "unit" }
const FILM = { id: 16, code: "FILM-001", displayName: "Film", packagingRole: "pallet" }
const CAJA_ESTANTE = { id: 17, code: "CAJ-002", displayName: "Caja de estante", packagingRole: "pallet" }
const ESQ_CARTON = { id: 18, code: "ESQ-001", displayName: "Esquinero de cartón", packagingRole: "pallet" }
const ESQ_MADERA = { id: 19, code: "ESQ-002", displayName: "Esquinero de madera", packagingRole: "pallet" }
const ALL_PACKAGINGS = [TAPA, ENVASE, CAJA, BOLSA_MASTER, SACO_REFORZADO, BOLSA_LOGO, FILM, CAJA_ESTANTE, ESQ_CARTON, ESQ_MADERA]

function baseRow(overrides: Partial<SheetRow> = {}): SheetRow {
    return {
        "Código Producto": PRODUCT.codigo,
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
        mockPackagingFindAll.mockReset().mockResolvedValue(ALL_PACKAGINGS)
        mockVariantFindAll.mockReset().mockResolvedValue([]) // sin (Producto, Presentación) existentes en la BD
        mockVariantCreate.mockReset().mockImplementation((data: object) => Promise.resolve({ id: 100, ...data }))
        mockUnitMaterialBulkCreate.mockReset().mockResolvedValue([])
        mockPalletMaterialBulkCreate.mockReset().mockResolvedValue([])
        mockIntermediateMaterialBulkCreate.mockReset().mockResolvedValue([])
        mockRecipeFindAll.mockReset().mockResolvedValue(COMPLETE_RECIPE)
    })

    describe("receta completa antes del SKU (2026-09-25)", () => {
        const skuRows = () => [
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ]

        it("rechaza el SKU de un producto fijo SIN receta (antes pasaba y cotizaba $0 de materia prima)", async () => {
            mockRecipeFindAll.mockResolvedValue([])
            const buffer = await buildWorkbookBuffer(skuRows())

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
                rowIssues: [expect.objectContaining({ row: 2, field: "productId", key: "errors.bulk_import_sku_recipe_incomplete" })],
            })
            expect(mockTransaction).not.toHaveBeenCalled()
            expect(mockVariantCreate).not.toHaveBeenCalled()
        })

        it("rechaza el SKU de un producto fijo cuya receta no suma 100", async () => {
            mockRecipeFindAll.mockResolvedValue([{ productId: PRODUCT.id, percentage: "60.00" }])
            const buffer = await buildWorkbookBuffer(skuRows())

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toBeInstanceOf(BulkImportError)
            expect(mockVariantCreate).not.toHaveBeenCalled()
        })

        it("solo cuenta filas de receta activas", async () => {
            const buffer = await buildWorkbookBuffer(skuRows())

            await productVariantImportService.bulkImportProductVariants(buffer)

            expect(mockRecipeFindAll).toHaveBeenCalledWith({ where: { isActive: true }, attributes: ["productId", "percentage"] })
        })

        it("un producto personalizable necesita al menos una materia prima en su pool (sin porcentajes)", async () => {
            mockProductFindAll.mockResolvedValue([{ ...PRODUCT, isCustomizable: true }])
            mockRecipeFindAll.mockResolvedValue([])
            const emptyPool = await buildWorkbookBuffer(skuRows())
            await expect(productVariantImportService.bulkImportProductVariants(emptyPool)).rejects.toBeInstanceOf(BulkImportError)

            mockRecipeFindAll.mockResolvedValue([{ productId: PRODUCT.id, percentage: null }])
            const withPool = await buildWorkbookBuffer(skuRows())
            await expect(productVariantImportService.bulkImportProductVariants(withPool)).resolves.toHaveLength(1)
        })
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
                boxesPerPallet: 385,
                bagsPerBox: 6,
                unitsPerIntermediatePackage: null,
            }),
            { transaction: { __fakeTransaction: true } }
        )
        expect(mockIntermediateMaterialBulkCreate).not.toHaveBeenCalled()
        expect(mockUnitMaterialBulkCreate).toHaveBeenCalledWith(
            [
                { productVariantId: 100, packagingId: TAPA.id, quantityPerUnit: 1, optionGroup: null, isDefault: false },
                { productVariantId: 100, packagingId: ENVASE.id, quantityPerUnit: 1, optionGroup: null, isDefault: false },
            ],
            { transaction: { __fakeTransaction: true } }
        )
        expect(mockPalletMaterialBulkCreate).toHaveBeenCalledWith(
            [{ productVariantId: 100, packagingId: CAJA.id, quantityValue: 385, optionGroup: null, isDefault: false }],
            { transaction: { __fakeTransaction: true } }
        )
    })

    it("dispatcha una fila de rol \"intermediate\" a una fila ProductVariantIntermediateMaterial + unitsPerIntermediatePackage en la variante, no a las tablas unit/pallet", async () => {
        const buffer = await buildWorkbookBuffer([
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código Material": BOLSA_MASTER.code, "Cantidad": 50 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
        ])

        await productVariantImportService.bulkImportProductVariants(buffer)

        expect(mockVariantCreate).toHaveBeenCalledWith(
            expect.objectContaining({ unitsPerIntermediatePackage: 50 }),
            expect.anything()
        )
        expect(mockIntermediateMaterialBulkCreate).toHaveBeenCalledWith(
            [{ productVariantId: 100, packagingId: BOLSA_MASTER.id, optionGroup: null, isDefault: false }],
            { transaction: { __fakeTransaction: true } }
        )
        // La bolsa grande no debe colarse como si fuera un material unit/pallet.
        expect(mockUnitMaterialBulkCreate).toHaveBeenCalledWith(
            [{ productVariantId: 100, packagingId: TAPA.id, quantityPerUnit: 1, optionGroup: null, isDefault: false }],
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

    describe("un SKU por (Producto, Presentación) -- identidad completa del SKU desde 2026-09-17", () => {
        it("rechaza un SKU nuevo si el (Producto, Presentación) ya lo usa una variante EXISTENTE en la BD", async () => {
            mockVariantFindAll.mockResolvedValue([
                { productId: PRODUCT.id, presentationId: PRESENTATION.id },
            ])
            const buffer = await buildWorkbookBuffer([
                baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
            ])

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
                rowIssues: expect.arrayContaining([
                    expect.objectContaining({
                        key: "errors.bulk_import_sku_presentation_already_used",
                        params: { productCodigo: PRODUCT.codigo, presentationLabel: PRESENTATION.displayLabel }
                    })
                ])
            })
            expect(mockTransaction).not.toHaveBeenCalled()
            expect(mockVariantCreate).not.toHaveBeenCalled()
        })
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
        const OTRA_PRESENTACION = { id: 3, displayLabel: "Otra Presentación" }
        mockPresentationFindAll.mockResolvedValue([PRESENTATION, OTRA_PRESENTACION])

        const buffer = await buildWorkbookBuffer([
            // SKU 1 (Producto + Presentación por defecto): válido
            baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
            baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
            // SKU 2 (misma Producto, OTRA Presentación): inválido (material desconocido)
            baseRow({ "Presentación": OTRA_PRESENTACION.displayLabel, "Código Material": "NO-EXISTE", "Cantidad": 1 }),
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
            [{ "Código Producto": PRODUCT.codigo }],
            ["Código Producto"]
        )

        await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({ key: "errors.bulk_import_missing_columns" })
        expect(mockTransaction).not.toHaveBeenCalled()
    })

    describe("grupos de opciones -- columnas opcionales Grupo + Predeterminado (2026-09-25)", () => {
        const TX = { transaction: { __fakeTransaction: true } }

        it("un archivo viejo de 6 columnas (sin Grupo/Predeterminado) importa todo como filas fijas", async () => {
            const buffer = await buildWorkbookBuffer([
                baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
            ])

            await productVariantImportService.bulkImportProductVariants(buffer)

            expect(mockUnitMaterialBulkCreate).toHaveBeenCalledWith(
                [{ productVariantId: 100, packagingId: TAPA.id, quantityPerUnit: 1, optionGroup: null, isDefault: false }],
                TX
            )
            expect(mockPalletMaterialBulkCreate).toHaveBeenCalledWith(
                [{ productVariantId: 100, packagingId: CAJA.id, quantityValue: 385, optionGroup: null, isDefault: false }],
                TX
            )
        })

        it("un SKU con una fila fija + dos grupos de paletización escribe grupo/default correctos en cada fila", async () => {
            const buffer = await buildWorkbookBuffer(
                [
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                    baseRow({ "Código Material": FILM.code, "Cantidad": 1 }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Grupo": "Caja" }),
                    baseRow({ "Código Material": CAJA_ESTANTE.code, "Cantidad": 385, "Grupo": "Caja", "Predeterminado": "Sí" }),
                    baseRow({ "Código Material": ESQ_CARTON.code, "Cantidad": 4, "Grupo": "Esquinero" }),
                    baseRow({ "Código Material": ESQ_MADERA.code, "Cantidad": 4, "Grupo": "Esquinero" }),
                ],
                GROUP_HEADERS
            )

            await productVariantImportService.bulkImportProductVariants(buffer)

            expect(mockPalletMaterialBulkCreate).toHaveBeenCalledWith(
                [
                    { productVariantId: 100, packagingId: FILM.id, quantityValue: 1, optionGroup: null, isDefault: false },
                    // "Caja": la segunda fila está marcada -> es la default, no la primera
                    { productVariantId: 100, packagingId: CAJA.id, quantityValue: 385, optionGroup: "Caja", isDefault: false },
                    { productVariantId: 100, packagingId: CAJA_ESTANTE.id, quantityValue: 385, optionGroup: "Caja", isDefault: true },
                    // "Esquinero": ninguna marcada -> la PRIMERA fila del grupo queda como default
                    { productVariantId: 100, packagingId: ESQ_CARTON.id, quantityValue: 4, optionGroup: "Esquinero", isDefault: true },
                    { productVariantId: 100, packagingId: ESQ_MADERA.id, quantityValue: 4, optionGroup: "Esquinero", isDefault: false },
                ],
                TX
            )
        })

        it("rechaza dos opciones marcadas como predeterminadas en el mismo grupo, nombrando el grupo", async () => {
            const buffer = await buildWorkbookBuffer(
                [
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Grupo": "Caja", "Predeterminado": "Sí" }),
                    baseRow({ "Código Material": CAJA_ESTANTE.code, "Cantidad": 385, "Grupo": "caja", "Predeterminado": "X" }),
                ],
                GROUP_HEADERS
            )

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
                rowIssues: [expect.objectContaining({
                    row: 4,
                    key: "errors.bulk_import_multiple_defaults_in_group",
                    params: { productCodigo: PRODUCT.codigo, presentationLabel: PRESENTATION.displayLabel, group: "Caja" }
                })]
            })
            expect(mockTransaction).not.toHaveBeenCalled()
        })

        it("rechaza Predeterminado marcado en una fila fija (sin Grupo)", async () => {
            const buffer = await buildWorkbookBuffer(
                [
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1, "Predeterminado": "Sí" }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
                ],
                GROUP_HEADERS
            )

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
                // La fila rechazada sale de su SKU, que además dispara el error de nivel faltante -- se
                // verifica que el error propio de la fila esté, no que sea el único.
                rowIssues: expect.arrayContaining([expect.objectContaining({ row: 2, field: "isDefault", key: "errors.bulk_import_default_without_group" })])
            })
            expect(mockTransaction).not.toHaveBeenCalled()
        })

        it("rechaza un valor de Predeterminado que no es Sí/No", async () => {
            const buffer = await buildWorkbookBuffer(
                [
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Grupo": "Caja", "Predeterminado": "quizás" }),
                ],
                GROUP_HEADERS
            )

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
                // La fila rechazada sale de su SKU, que además dispara el error de nivel faltante -- se
                // verifica que el error propio de la fila esté, no que sea el único.
                rowIssues: expect.arrayContaining([expect.objectContaining({ row: 3, key: "errors.bulk_import_invalid_boolean", params: { value: "quizás" } })])
            })
        })

        it("rechaza un nombre de grupo de más de 60 caracteres", async () => {
            const buffer = await buildWorkbookBuffer(
                [
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Grupo": "C".repeat(61) }),
                ],
                GROUP_HEADERS
            )

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
                // La fila rechazada sale de su SKU, que además dispara el error de nivel faltante -- se
                // verifica que el error propio de la fila esté, no que sea el único.
                rowIssues: expect.arrayContaining([expect.objectContaining({ row: 3, field: "optionGroup", key: "errors.bulk_import_option_group_too_long", params: expect.objectContaining({ max: 60 }) })])
            })
        })

        it("\"caja\" y \"CAJA \" son UN grupo, con la grafía de su primera fila", async () => {
            const buffer = await buildWorkbookBuffer(
                [
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Grupo": "caja" }),
                    baseRow({ "Código Material": CAJA_ESTANTE.code, "Cantidad": 385, "Grupo": "CAJA  " }),
                ],
                GROUP_HEADERS
            )

            await productVariantImportService.bulkImportProductVariants(buffer)

            expect(mockPalletMaterialBulkCreate).toHaveBeenCalledWith(
                [
                    expect.objectContaining({ packagingId: CAJA.id, optionGroup: "caja", isDefault: true }),
                    expect.objectContaining({ packagingId: CAJA_ESTANTE.id, optionGroup: "caja", isDefault: false }),
                ],
                TX
            )
        })

        it("el mismo nombre de grupo en empaque individual y en paletización son DOS grupos (cada uno con su default)", async () => {
            const buffer = await buildWorkbookBuffer(
                [
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1, "Grupo": "Opción" }),
                    baseRow({ "Código Material": BOLSA_LOGO.code, "Cantidad": 1, "Grupo": "Opción" }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Grupo": "Opción" }),
                    baseRow({ "Código Material": CAJA_ESTANTE.code, "Cantidad": 385, "Grupo": "Opción", "Predeterminado": "Sí" }),
                ],
                GROUP_HEADERS
            )

            await productVariantImportService.bulkImportProductVariants(buffer)

            expect(mockUnitMaterialBulkCreate).toHaveBeenCalledWith(
                [
                    expect.objectContaining({ packagingId: TAPA.id, optionGroup: "Opción", isDefault: true }),
                    expect.objectContaining({ packagingId: BOLSA_LOGO.id, optionGroup: "Opción", isDefault: false }),
                ],
                TX
            )
            expect(mockPalletMaterialBulkCreate).toHaveBeenCalledWith(
                [
                    expect.objectContaining({ packagingId: CAJA.id, optionGroup: "Opción", isDefault: false }),
                    expect.objectContaining({ packagingId: CAJA_ESTANTE.id, optionGroup: "Opción", isDefault: true }),
                ],
                TX
            )
        })

        it("admite varias filas de empaque intermedio (fijas y en grupo) y las escribe con su grupo/default", async () => {
            const buffer = await buildWorkbookBuffer(
                [
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                    baseRow({ "Código Material": BOLSA_MASTER.code, "Cantidad": 50, "Grupo": "Saco" }),
                    baseRow({ "Código Material": SACO_REFORZADO.code, "Cantidad": 50, "Grupo": "Saco", "Predeterminado": "Sí" }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
                ],
                GROUP_HEADERS
            )

            await productVariantImportService.bulkImportProductVariants(buffer)

            expect(mockVariantCreate).toHaveBeenCalledWith(expect.objectContaining({ unitsPerIntermediatePackage: 50 }), TX)
            expect(mockIntermediateMaterialBulkCreate).toHaveBeenCalledWith(
                [
                    { productVariantId: 100, packagingId: BOLSA_MASTER.id, optionGroup: "Saco", isDefault: false },
                    { productVariantId: 100, packagingId: SACO_REFORZADO.id, optionGroup: "Saco", isDefault: true },
                ],
                TX
            )
        })

        it("rechaza filas de empaque intermedio del mismo SKU con Cantidad distinta (es un solo unitsPerIntermediatePackage)", async () => {
            const buffer = await buildWorkbookBuffer(
                [
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                    baseRow({ "Código Material": BOLSA_MASTER.code, "Cantidad": 50, "Grupo": "Saco" }),
                    baseRow({ "Código Material": SACO_REFORZADO.code, "Cantidad": 25, "Grupo": "Saco" }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
                ],
                GROUP_HEADERS
            )

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
                rowIssues: [expect.objectContaining({
                    row: 4,
                    field: "quantity",
                    key: "errors.bulk_import_intermediate_quantity_mismatch",
                    params: { productCodigo: PRODUCT.codigo, presentationLabel: PRESENTATION.displayLabel }
                })]
            })
            expect(mockTransaction).not.toHaveBeenCalled()
        })

        it("un material intermedio repetido es un error de fila claro (antes solo fallaba contra el índice único de la BD)", async () => {
            const buffer = await buildWorkbookBuffer([
                baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                baseRow({ "Código Material": BOLSA_MASTER.code, "Cantidad": 50 }),
                baseRow({ "Código Material": BOLSA_MASTER.code, "Cantidad": 50 }),
                baseRow({ "Código Material": CAJA.code, "Cantidad": 385 }),
            ])

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toMatchObject({
                rowIssues: [expect.objectContaining({ row: 4, key: "errors.bulk_import_duplicate_material_in_sku" })]
            })
            expect(mockTransaction).not.toHaveBeenCalled()
        })

        it("una sola fila mala con grupos rechaza el archivo entero -- nada se escribe", async () => {
            const OTRA_PRESENTACION = { id: 3, displayLabel: "Otra Presentación" }
            mockPresentationFindAll.mockResolvedValue([PRESENTATION, OTRA_PRESENTACION])
            const buffer = await buildWorkbookBuffer(
                [
                    // SKU 1 válido, con grupo
                    baseRow({ "Código Material": TAPA.code, "Cantidad": 1 }),
                    baseRow({ "Código Material": CAJA.code, "Cantidad": 385, "Grupo": "Caja" }),
                    // SKU 2 inválido: Predeterminado en fila fija
                    baseRow({ "Presentación": OTRA_PRESENTACION.displayLabel, "Código Material": TAPA.code, "Cantidad": 1 }),
                    baseRow({ "Presentación": OTRA_PRESENTACION.displayLabel, "Código Material": CAJA.code, "Cantidad": 385, "Predeterminado": "Sí" }),
                ],
                GROUP_HEADERS
            )

            await expect(productVariantImportService.bulkImportProductVariants(buffer)).rejects.toBeInstanceOf(BulkImportError)
            expect(mockTransaction).not.toHaveBeenCalled()
            expect(mockVariantCreate).not.toHaveBeenCalled()
            expect(mockPalletMaterialBulkCreate).not.toHaveBeenCalled()
        })
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
            { id: 23, code: "CAJ-002", displayName: "Caja de estante", packagingRole: "pallet" },
            { id: 24, code: "FILM-001", displayName: "Film stretch", packagingRole: "pallet" },
            { id: 25, code: "ESQ-001", displayName: "Esquinero de cartón", packagingRole: "pallet" },
            { id: 26, code: "ESQ-002", displayName: "Esquinero de madera", packagingRole: "pallet" },
        ])
        mockVariantFindAll.mockResolvedValue([])
        mockVariantCreate.mockImplementation((data: object) => Promise.resolve({ id: 200, ...data }))
        // Ambos productos del ejemplo con receta completa (gate de 2026-09-25).
        mockRecipeFindAll.mockResolvedValue([...COMPLETE_RECIPE, { productId: 2, percentage: "100.00" }])

        const templateBuffer = await productVariantImportService.buildProductVariantImportTemplate()

        const workbook = new ExcelJS.Workbook()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo choque de tipos de exceljs documentado en productVariantImport.service.ts
        await workbook.xlsx.load(templateBuffer as any)
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["SKUs", "Instrucciones"])
        const headerValues = workbook.getWorksheet("SKUs")!.getRow(1).values as unknown[]
        expect(headerValues).toEqual(expect.arrayContaining(["Grupo", "Predeterminado"]))

        const result = await productVariantImportService.bulkImportProductVariants(templateBuffer)
        expect(result.length).toBe(2)
        // El ejemplo DEMO-PROD: film fijo + "Caja" (CAJ-001 marcada) + "Esquinero" (primera fila por defecto)
        expect(mockPalletMaterialBulkCreate).toHaveBeenLastCalledWith(
            [
                expect.objectContaining({ packagingId: 24, optionGroup: null, isDefault: false }),
                expect.objectContaining({ packagingId: 22, optionGroup: "Caja", isDefault: true }),
                expect.objectContaining({ packagingId: 23, optionGroup: "Caja", isDefault: false }),
                expect.objectContaining({ packagingId: 25, optionGroup: "Esquinero", isDefault: true }),
                expect.objectContaining({ packagingId: 26, optionGroup: "Esquinero", isDefault: false }),
            ],
            expect.anything()
        )
    })
})
