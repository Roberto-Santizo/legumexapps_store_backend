import "reflect-metadata"
import { Op } from "sequelize"

// Mocks manuales de los modelos: quote.service.ts solo llama a ProductVariant.findOne,
// Destination.findOne y Quote.create -- no hace falta una base de datos real ni los
// decoradores de sequelize-typescript para probar la lógica de negocio de calculateQuote.
// Cada mock devuelve un objeto plano con exactamente la forma que calculateQuote lee
// (ver quote.service.ts), no una instancia real de Sequelize.
jest.mock("../../product/models/ProductVariant.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
// Solo para listQuotableProducts -- el resto de las suites de este archivo (calculateQuote/
// saveQuote) no lo tocan.
jest.mock("../../product/models/Product.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn() }
}))
jest.mock("../../destination/models/Destination.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
jest.mock("../models/Quote.model", () => ({
    __esModule: true,
    default: { create: jest.fn(), findAll: jest.fn() }
}))
// Catálogo de costos adicionales: por defecto SIN filas activas (ver beforeEach); los tests de
// "costos adicionales" más abajo pisan este mock.
jest.mock("../../processingCost/models/ProcessingCost.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn() }
}))
// Borradores (cotizaciones sin finalizar): saveQuote solo llama a markConverted DESPUÉS del Quote.create.
jest.mock("../../quoteDraft/services/quoteDraft.service", () => ({
    quoteDraftService: { upsertFromCalculation: jest.fn(), markConverted: jest.fn(), listDrafts: jest.fn() }
}))

import ProductVariant from "../../product/models/ProductVariant.model"
import Product from "../../product/models/Product.model"
import Destination from "../../destination/models/Destination.model"
import Quote from "../models/Quote.model"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import { quoteService } from "./quote.service"
import { quoteDraftService } from "../../quoteDraft/services/quoteDraft.service"
import { NotFoundError } from "../../../shared/errors/AppError"
import { CalculateQuoteInput, calculateQuoteSchema } from "../schemas/quote.schema"
// Se importa el catálogo REAL (no mockeado -- es un módulo de constantes puro, sin Sequelize) para
// derivar el factor gramos->libras de la misma fuente que usa quote.service.ts, en vez de
// hardcodear "453.592" una tercera vez en este archivo. Si algún día quote.service.ts dejara de
// leer este catálogo y usara una constante propia desalineada, estos tests lo detectan solos.
import { getUnitCatalogEntry } from "../../unit/constants/unitCatalog"

const mockVariantFindOne = ProductVariant.findOne as unknown as jest.Mock
const mockProductFindAll = Product.findAll as unknown as jest.Mock
const mockDestinationFindOne = Destination.findOne as unknown as jest.Mock
const mockQuoteCreate = Quote.create as unknown as jest.Mock
const mockProcessingCostFindAll = ProcessingCost.findAll as unknown as jest.Mock

// Costo de destino usado en todos los casos salvo que un test lo pise explícitamente.
const DESTINATION = { id: 900, displayName: "Puerto Cortés", baseCost: 50 }

function stubDestination(overrides: Partial<typeof DESTINATION> = {}): void {
    mockDestinationFindOne.mockResolvedValue({ ...DESTINATION, ...overrides })
}

describe("quoteService.calculateQuote", () => {
    beforeEach(() => {
        stubDestination()
        mockProcessingCostFindAll.mockResolvedValue([]) // catálogo vacío por defecto, ver comentario del mock arriba
    })

    const baseInput: CalculateQuoteInput = {
        productVariantId: 10,
        destinationId: 900,
        requestedPallets: 1,
    }

    describe("guardas de negocio (config faltante / inválida)", () => {
        it("rechaza si la variante no existe (NotFoundError)", async () => {
            mockVariantFindOne.mockResolvedValue(null)

            await expect(quoteService.calculateQuote(baseInput)).rejects.toBeInstanceOf(NotFoundError)
        })

        it("rechaza si el destino no existe (NotFoundError)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
            mockDestinationFindOne.mockResolvedValue(null)

            await expect(quoteService.calculateQuote(baseInput)).rejects.toBeInstanceOf(NotFoundError)
        })

        it("rechaza si la variante no tiene boxesPerPallet configurado (bug histórico: cotizar sin palet configurado)", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, boxesPerPallet: null, bagsPerBox: 5, parentProduct: { isCustomizable: false, productRawMaterials: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })

        it("rechaza si la variante no tiene bagsPerBox configurado (mismo guard, el otro factor de la derivación)", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, boxesPerPallet: 4, bagsPerBox: null, parentProduct: { isCustomizable: false, productRawMaterials: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })

        it("rechaza boxesPerPallet en 0 igual que null", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, boxesPerPallet: 0, bagsPerBox: 5, parentProduct: { isCustomizable: false, productRawMaterials: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })

        it("rechaza bagsPerBox en 0 igual que null", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, boxesPerPallet: 4, bagsPerBox: 0, parentProduct: { isCustomizable: false, productRawMaterials: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })

        it("bagsPerPallet se deriva como boxesPerPallet × bagsPerBox (no como un input directo) -- totalUnits lo prueba end-to-end", async () => {
            // 4 cajas/palet × 5 bolsas/caja = 20 bolsas/palet.
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 4,
                bagsPerBox: 5,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 3 })

            // totalUnits = requestedPallets(3) * boxesPerPallet(4) * bagsPerBox(5) = 60
            expect(result.totalUnits).toBe(60)
        })
    })

    describe("transporte apagado (sin destinationId, 2026-09-10 -- el cliente ya no elige destino)", () => {
        // percentage:100 (única materia prima activa) + netWeightGrams(0.5)/baseFactor(1) da
        // quantityPerUnit 0.5 y rawMaterialCost 200 (ver la convención en el describe "receta fija").
        function stubMinimalVariant(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Piña en Trozos",
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1 } } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 0.5 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa plástica", unitCost: 1 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
        }

        const inputWithoutDestination: CalculateQuoteInput = { productVariantId: 10, requestedPallets: 1 }

        it("no consulta Destination y resuelve transporte en $0 cuando destinationId no viene en el input", async () => {
            stubMinimalVariant()

            const result = await quoteService.calculateQuote(inputWithoutDestination)

            expect(mockDestinationFindOne).not.toHaveBeenCalled()
            expect(result.transportCost).toBe(0)
            expect(result.destinationId).toBeNull()
            expect(result.breakdown.transport).toEqual({ destinationId: null, displayName: "Sin destino", baseCost: 0 })
        })

        it("el total no incluye transporte y no da NaN/undefined cuando no hay destino", async () => {
            stubMinimalVariant()

            const result = await quoteService.calculateQuote(inputWithoutDestination)

            // rawMaterialCost = costPerUnit(20) * quantityPerUnit(0.5) * totalUnits(20) = 200
            // unitPackagingCost = unitCost(1) * totalUnits(20) = 20
            // total = 220, sin componente de transporte
            expect(result.totalCost).toBe(220)
            expect(Number.isNaN(result.totalCost)).toBe(false)
        })

        it("sigue rechazando un destinationId que sí se manda pero no existe -- solo dejó de ser obligatorio, no dejó de validarse", async () => {
            stubMinimalVariant()
            mockDestinationFindOne.mockResolvedValue(null)

            await expect(quoteService.calculateQuote(baseInput)).rejects.toBeInstanceOf(NotFoundError)
        })

        it("saveQuote persiste destinationId: null y transportCost: 0 sin lanzar error cuando no se manda destino", async () => {
            stubMinimalVariant()
            mockQuoteCreate.mockResolvedValueOnce({ id: 99, get: () => new Date("2026-09-10T00:00:00Z") })

            const saved = await quoteService.saveQuote(42, { ...inputWithoutDestination })

            expect(saved.destinationId).toBeNull()
            expect(mockQuoteCreate.mock.calls[0][0]).toMatchObject({ destinationId: null, transportCost: 0 })
        })
    })

    describe("receta fija (producto no personalizable, pivote a % 2026-09-19)", () => {
        it("freezes product SKU, material codes, recipe grams and order customer in the saved breakdown", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10, productId: 8, skuCode: "PTC3010111", boxesPerPallet: 20, bagsPerBox: 2,
                parentProduct: { isActive: true, isCustomizable: false, displayName: "Pineapple", productRawMaterials: [{ rawMaterialId: 1, percentage: 100, usedRawMaterial: { code: "MP001", displayName: "Pineapple", costPerUnit: 2, costUnit: { unitCode: "kilogram", unitType: "weight", baseFactor: 1000 } } }] },
                sizePresentation: { displayLabel: "500 g", netWeightGrams: 500 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { code: "EMP001", displayName: "Bag", unitCost: 1 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { code: "EMP002", displayName: "Pallet", unitCost: 5 } }],
            })
            mockQuoteCreate.mockResolvedValueOnce({ id: 99, get: () => new Date("2026-10-08T12:00:00Z") })
            const order = { id: "5e226064-21be-4a9a-a5e5-f312391e363a", clientName: "Customer A" }
            const result = await quoteService.saveQuote(42, { productVariantId: 10, requestedPallets: 2, order })
            expect(result.breakdown.production).toMatchObject({ skuCode: "PTC3010111", productId: 8, boxesPerPallet: 20, bagsPerBox: 2, netWeightGrams: 500 })
            expect(result.breakdown.rawMaterials[0]).toMatchObject({ code: "MP001", percentage: 100, gramsPerUnit: 500, quantityUnit: "kilogram" })
            expect(result.breakdown.unitMaterials[0].code).toBe("EMP001")
            expect(result.breakdown.palletMaterials[0].code).toBe("EMP002")
            expect(mockQuoteCreate.mock.calls.at(-1)[0].breakdown.order).toEqual(order)
        })
        // La receta fija usa la misma matemática %->gramos->costo que el mix personalizable; el % lo fija el
        // admin. Convención de este archivo: con una sola materia prima activa se usa percentage:100,
        // costUnit.baseFactor=1 y netWeightGrams = la cantidad por unidad buscada, así
        // quantityPerUnit = 100/100 * netWeightGrams / 1. Donde netWeightGrams importa para otra cosa (costos
        // por peso), se deja su valor real y se ajusta baseFactor = netWeightGrams / cantidad.
        function stubFixedRecipeVariant(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Piña en Trozos",
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1 } } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 0.5 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa plástica", unitCost: 1 } }],
                palletMaterials: [
                    { packagingId: 6, quantityValue: 10, usedPalletMaterial: { displayName: "Caja corrugada", unitCost: 1 } },
                    { packagingId: 7, quantityValue: 4, usedPalletMaterial: { displayName: "Parales", unitCost: 1 } }
                ]
            })
        }

        it("calcula el total correcto sumando materia prima + empaque + materiales de palet + transporte", async () => {
            stubFixedRecipeVariant()

            const result = await quoteService.calculateQuote(baseInput)

            // totalUnits = 1 palet * 20 unidades/palet = 20
            expect(result.totalUnits).toBe(20)
            // rawMaterialCost = costPerUnit(20) * quantityPerUnit(0.5) * totalUnits(20)
            expect(result.rawMaterialCost).toBe(200)
            // unitPackagingCost = unitCost(1) * totalUnits(20)
            expect(result.unitPackagingCost).toBe(20)
            // palletMaterialCost = (1*10*1) + (1*4*1)
            expect(result.palletMaterialCost).toBe(14)
            expect(result.transportCost).toBe(50)
            expect(result.totalCost).toBe(284)
        })

        it("conserva hasta 4 decimales de precisión en vez de redondear a centavos (2026-08-24, a pedido explícito del usuario)", async () => {
            // costPerUnit con 4 decimales significativos: el lineTotal real tiene 4 decimales (0.1234), no se
            // trunca a 0.12.
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Trazas", costPerUnit: 0.1234, costUnit: { unitType: "weight", baseFactor: 1 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: 1 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            // rawMaterialCost = 0.1234 * 1 * 1 = 0.1234 -- exacto, no 0.12
            expect(result.rawMaterialCost).toBe(0.1234)
            expect(result.breakdown.rawMaterials[0].lineTotal).toBe(0.1234)
        })

        it("multiplica el costo de materiales de palet por la cantidad de palets solicitados, no por totalUnits", async () => {
            stubFixedRecipeVariant()

            const result = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 3 })

            // palletMaterialCost escala con requestedPallets (3), no con totalUnits (60)
            expect(result.palletMaterialCost).toBe(42) // 14 * 3
            expect(result.totalUnits).toBe(60)
        })

        it("rechaza si la variante no tiene NINGÚN material de empaque individual configurado (2026-09-11: antes sumaba $0 en silencio, ver memoria del proyecto)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.unit_materials_not_configured" })
        })

        it("no revienta si el empaque unitario asignado tiene costo $0 (material gratis, distinto de NO tener materiales)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque gratis", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.unitPackagingCost).toBe(0)
            expect(result.breakdown.unitMaterials).toHaveLength(1)
        })

        it("rechaza si la variante no tiene NINGÚN material de paletización configurado (2026-09-11: antes sumaba $0 en silencio, ver memoria del proyecto)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: []
            })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_materials_not_configured" })
        })

        it("no revienta si el único material de palet asignado tiene costo $0 (material gratis, distinto de NO tener materiales)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja gratis", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.palletMaterialCost).toBe(0)
            expect(result.breakdown.palletMaterials).toHaveLength(1)
        })

        it("intermediatePackagingCost queda en 0 y el breakdown vacío cuando la variante no tiene empaque intermedio (caso normal, la mayoría de variantes)", async () => {
            stubFixedRecipeVariant()

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.intermediatePackagingCost).toBe(0)
            expect(result.breakdown.intermediateMaterials).toEqual([])
        })

        it("no revienta con una materia prima gratis (costPerUnit = 0) -- la línea da 0, no NaN/undefined", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Agua", costPerUnit: 0, costUnit: { unitType: "weight", baseFactor: 1 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: 5 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.rawMaterialCost).toBe(0)
            expect(result.breakdown.rawMaterials[0].lineTotal).toBe(0)
            expect(Number.isNaN(result.totalCost)).toBe(false)
        })

        it("no revienta con quantityValue = 0 en un material de palet -- la línea da 0, no negativo ni NaN", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [
                    { packagingId: 6, quantityValue: 0, usedPalletMaterial: { displayName: "Caja corrugada", unitCost: 5 } }
                ]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.palletMaterialCost).toBe(0)
            expect(result.breakdown.palletMaterials[0].lineTotal).toBe(0)
        })

        it("reconcilia exacto (sin arrastre de precisión) con 3 materias primas de receta fija en costos que drift en floats nativos", async () => {
            // Tercios en receta fija: netWeightGrams=100 y costUnit.baseFactor == percentage para cada fila dan
            // quantityPerUnit exacto 1; los % (33.34/33.33/33.33) ejercitan la suma a 100.
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 33.34, usedRawMaterial: { displayName: "A", costPerUnit: 0.1, costUnit: { unitType: "weight", baseFactor: 33.34 } } },
                        { rawMaterialId: 2, percentage: 33.33, usedRawMaterial: { displayName: "B", costPerUnit: 0.2, costUnit: { unitType: "weight", baseFactor: 33.33 } } },
                        { rawMaterialId: 3, percentage: 33.33, usedRawMaterial: { displayName: "C", costPerUnit: 0.0001, costUnit: { unitType: "weight", baseFactor: 33.33 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: 100 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            // 0.1 + 0.2 + 0.0001 da 0.30010000000000003 con `+` nativo -- debe dar exacto 0.3001.
            expect(result.rawMaterialCost).toBe(0.3001)
        })

        it("escala sin arrastre de precisión con cantidades grandes de palets (multiplicación a gran escala)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 500,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "A", costPerUnit: 7.77, costUnit: { unitType: "weight", baseFactor: 1 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: 0.3333 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa", unitCost: 1.11 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 10000 })

            expect(result.totalUnits).toBe(5000000)
            // El total debe reconciliar exacto con la suma de los subtotales que ve el cliente,
            // sin importar la escala del cálculo.
            expect(result.totalCost).toBe(
                result.rawMaterialCost + result.unitPackagingCost + result.intermediatePackagingCost + result.palletMaterialCost + result.transportCost
            )
            expect(Number.isFinite(result.totalCost)).toBe(true)
        })
    })

    describe("ajuste manual de costo por unidad (Product.additionalCostPerUnit, costos aún no definidos en el catálogo)", () => {
        function stubVariantWithAdjustment(additionalCostPerUnit: number | null): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [], additionalCostPerUnit },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
        }

        it("multiplica additionalCostPerUnit por totalUnits y lo suma al total", async () => {
            stubVariantWithAdjustment(0.3)

            const result = await quoteService.calculateQuote(baseInput)

            // totalUnits = 20 (1 palet * 20 unidades/palet); adjustmentCost = 0.3 * 20
            expect(result.adjustmentCost).toBe(6)
            expect(result.totalCost).toBe(56) // transportCost(50) + adjustmentCost(6)
            expect(result.breakdown.adjustment).toEqual({ unitCost: 0.3, totalUnits: 20, lineTotal: 6 })
        })

        it("no agrega línea ni costo cuando additionalCostPerUnit es null (caso normal, sin ajuste)", async () => {
            stubVariantWithAdjustment(null)

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.adjustmentCost).toBe(0)
            expect(result.breakdown.adjustment).toBeNull()
            expect(result.totalCost).toBe(50) // solo transportCost
        })

        it("no revienta si el producto no trae additionalCostPerUnit en absoluto (dato viejo, antes de este campo)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.adjustmentCost).toBe(0)
            expect(result.breakdown.adjustment).toBeNull()
        })
    })

    describe("costos adicionales por peso (catálogo ProcessingCost, energía/mano de obra/etc.)", () => {
        // netWeightGrams es el parámetro bajo prueba (null/0/negativo/string), así que se ajusta
        // costUnit.baseFactor = netWeightGrams * 2 para que quantityPerUnit dé 0.5 y rawMaterialCost 200 con
        // peso positivo. Para null/0/negativo se rechaza con errors.presentation_missing_net_weight antes de
        // usar costUnit, así que el baseFactor de respaldo (1000) nunca se usa.
        function stubVariantForProcessingCosts(netWeightGrams: number | string | null): void {
            const numericWeight = netWeightGrams ? Number(netWeightGrams) : 0
            const baseFactor = numericWeight > 0 ? numericWeight * 2 : 1000
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Piña en Trozos",
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor } } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa plástica", unitCost: 1 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
        }

        it("no agrega ninguna línea ni costo si el catálogo está vacío (estado inicial, el admin todavía no cargó nada)", async () => {
            stubVariantForProcessingCosts(2000)
            mockProcessingCostFindAll.mockResolvedValue([])

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.processingCostTotal).toBe(0)
            expect(result.breakdown.processingCosts).toEqual([])
        })

        it("consulta SOLO costos activos con calculationType 'per_weight' (excluye inactivos y 'percentage' a nivel de query)", async () => {
            stubVariantForProcessingCosts(2000)
            mockProcessingCostFindAll.mockResolvedValue([])

            await quoteService.calculateQuote(baseInput)

            expect(mockProcessingCostFindAll).toHaveBeenCalledWith(
                expect.objectContaining({ where: { isActive: true, calculationType: "per_weight" } })
            )
        })

        it("aplica un costo activo sobre el peso total (netWeightGrams * totalUnits, convertido de gramos a libras)", async () => {
            // Presentación de 2000g, 1 palet * 20 unidades/palet = 20 unidades -> 40000g totales.
            // 40000g / 453.592 g/lb = 88.18490245... lb. Costo USD 0.15/lb.
            stubVariantForProcessingCosts(2000)
            mockProcessingCostFindAll.mockResolvedValue([
                { id: 1, displayName: "Energía", value: 0.15, calculationType: "per_weight", translations: [] }
            ])

            const result = await quoteService.calculateQuote(baseInput)

            const expectedPounds = 40000 / 453.592
            const expectedLineTotal = Math.round(0.15 * expectedPounds * 10000) / 10000
            expect(result.breakdown.processingCosts).toEqual([
                expect.objectContaining({ processingCostId: 1, displayName: "Energía", value: 0.15, lineTotal: expectedLineTotal })
            ])
            expect(result.processingCostTotal).toBe(expectedLineTotal)
            // rawMaterialCost(200) + unitPackagingCost(20) + processingCostTotal + transportCost(50)
            expect(result.totalCost).toBe(200 + 20 + expectedLineTotal + 50)
        })

        it("suma varios costos adicionales activos a la vez (energía + mano de obra indirecta)", async () => {
            stubVariantForProcessingCosts(2000)
            mockProcessingCostFindAll.mockResolvedValue([
                { id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [] },
                { id: 2, displayName: "Mano de obra indirecta", value: 0.05, calculationType: "per_weight", translations: [] }
            ])

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.breakdown.processingCosts).toHaveLength(2)
            expect(result.processingCostTotal).toBe(
                result.breakdown.processingCosts[0].lineTotal + result.breakdown.processingCosts[1].lineTotal
            )
        })

        it("usa la traducción al inglés del nombre cuando se pide language='en'", async () => {
            stubVariantForProcessingCosts(2000)
            mockProcessingCostFindAll.mockResolvedValue([
                { id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [{ language: "en", displayName: "Energy" }] }
            ])

            const result = await quoteService.calculateQuote(baseInput, "en")

            expect(result.breakdown.processingCosts[0].displayName).toBe("Energy")
        })

        it("rechaza si hay costos activos pero la presentación no tiene peso neto configurado", async () => {
            stubVariantForProcessingCosts(null)
            mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [] }])

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.presentation_missing_net_weight" })
        })

        it("ahora SÍ exige peso neto aunque el catálogo de costos adicionales esté vacío -- cambio de comportamiento intencional (pivote de receta fija a %, 2026-09-19): antes quantityValue era una cantidad absoluta independiente de la presentación, ahora el % siempre necesita el peso neto para convertirse a gramos, igual que el mix personalizable", async () => {
            stubVariantForProcessingCosts(null)
            mockProcessingCostFindAll.mockResolvedValue([])

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.presentation_missing_net_weight" })
        })

        it("rechaza si netWeightGrams es exactamente 0 (no solo null/undefined) mientras hay costos activos -- nunca se asume peso 0 en silencio", async () => {
            stubVariantForProcessingCosts(0)
            mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [] }])

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.presentation_missing_net_weight" })
        })

        it("rechaza si netWeightGrams es negativo (dato corrupto) mientras hay costos activos", async () => {
            stubVariantForProcessingCosts(-500)
            mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [] }])

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.presentation_missing_net_weight" })
        })

        it("rechaza si la variante no tiene sizePresentation en absoluto (undefined, no solo netWeightGrams vacío) mientras hay costos activos", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Piña en Trozos",
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1 } } }
                    ]
                },
                // sin sizePresentation -- variant.sizePresentation?.netWeightGrams debe caer a undefined, no reventar
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa plástica", unitCost: 1 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
            mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [] }])

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.presentation_missing_net_weight" })
        })

        it("acepta netWeightGrams como string (\"2000\") -- Sequelize devuelve columnas DECIMAL como string en un SELECT normal", async () => {
            // Simula deliberadamente la forma cruda que devuelve Sequelize (string) en vez del tipo declarado (number)
            stubVariantForProcessingCosts("2000")
            mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [] }])

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.processingCostTotal).toBeGreaterThan(0)
            expect(Number.isFinite(result.processingCostTotal)).toBe(true)
        })

        it("acepta el value de un ProcessingCost como string (\"0.15\") -- mismo motivo, DECIMAL crudo de Sequelize", async () => {
            stubVariantForProcessingCosts(453.592) // exactamente 1 libra por unidad
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Piña en Trozos",
                    productRawMaterials: [{ rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 907.184 } } }]
                },
                sizePresentation: { displayLabel: "Bolsa", netWeightGrams: 453.592 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
            // El mock no está tipado contra el modelo real (ver "as unknown as jest.Mock" arriba),
            // así que "2" como string pasa el compilador igual que en producción: Sequelize
            // devuelve DECIMAL crudo como string y toDecimal() del backend ya sabe leerlo.
            mockProcessingCostFindAll.mockResolvedValue([
                { id: 1, displayName: "Energía", value: "2", calculationType: "per_weight", translations: [] }
            ])

            const result = await quoteService.calculateQuote(baseInput)

            // totalUnits = 1 palet * 1 unidad/palet = 1; 1 unidad * 453.592g = exactamente 1 libra.
            expect(result.processingCostTotal).toBe(2)
        })

        describe("conversión gramos->libras usa el baseFactor REAL del catálogo de unidades, no una constante duplicada", () => {
            function stubVariantWithWeight(netWeightGrams: number, boxesPerPallet: number): void {
                mockVariantFindOne.mockResolvedValue({
                    id: 10,
                    boxesPerPallet,
                    bagsPerBox: 1,
                    parentProduct: {
                        isCustomizable: false,
                        displayName: "Producto de prueba",
                        // percentage:100/baseFactor:1 arbitrarios (ninguno de estos sub-tests
                        // asegura rawMaterialCost, solo processingCostTotal/totalWeightPounds) --
                        // solo necesitan no reventar bajo el nuevo guard de costUnit de peso.
                        productRawMaterials: [{ rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "X", costPerUnit: 1, costUnit: { unitType: "weight", baseFactor: 1 } } }]
                    },
                    sizePresentation: { displayLabel: "Presentación", netWeightGrams },
                    unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                    palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
                })
            }

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- catálogo estático hardcodeado, "pound" siempre existe (ver unitCatalog.ts)
            const GRAMS_PER_POUND = getUnitCatalogEntry("pound")!.baseFactor

            it("1 unidad de exactamente 1 libra de peso neto, costo USD 2/lb -> USD 2 exactos (número limpio, verificable a mano)", async () => {
                stubVariantWithWeight(GRAMS_PER_POUND, 1) // 1 palet * 1 unidad/palet = 1 unidad de 1lb
                mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 2, calculationType: "per_weight", translations: [] }])

                const result = await quoteService.calculateQuote(baseInput)

                expect(result.processingCostTotal).toBe(2)
                expect(result.breakdown.processingCosts[0].totalWeightPounds).toBe(1)
            })

            it("1 unidad de exactamente 2 libras de peso neto, costo USD 1/lb -> USD 2 exactos", async () => {
                stubVariantWithWeight(GRAMS_PER_POUND * 2, 1)
                mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 1, calculationType: "per_weight", translations: [] }])

                const result = await quoteService.calculateQuote(baseInput)

                expect(result.processingCostTotal).toBe(2)
                expect(result.breakdown.processingCosts[0].totalWeightPounds).toBe(2)
            })

            it("10 unidades de exactamente 1 libra cada una, costo USD 1/lb -> USD 10 exactos (escala con totalUnits)", async () => {
                stubVariantWithWeight(GRAMS_PER_POUND, 10) // 1 palet * 10 unidades/palet
                mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 1, calculationType: "per_weight", translations: [] }])

                const result = await quoteService.calculateQuote(baseInput)

                expect(result.processingCostTotal).toBe(10)
                expect(result.breakdown.processingCosts[0].totalWeightPounds).toBe(10)
            })

            it("usa el mismo baseFactor que expone el catálogo de unidades para un peso NO limpio (1000g) -- si quote.service.ts usara una constante propia desalineada, este número no coincidiría", async () => {
                stubVariantWithWeight(1000, 1)
                mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 1, calculationType: "per_weight", translations: [] }])

                const result = await quoteService.calculateQuote(baseInput)

                const expectedPounds = 1000 / GRAMS_PER_POUND
                const expectedLineTotal = Math.round(1 * expectedPounds * 10000) / 10000
                expect(result.processingCostTotal).toBe(expectedLineTotal)
            })
        })

        it("suma exacta de 3 costos adicionales activos a la vez (energía + análisis de laboratorio + mantenimiento), no solo una comparación relativa", async () => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- catálogo estático hardcodeado, "pound" siempre existe (ver unitCatalog.ts)
            const GRAMS_PER_POUND = getUnitCatalogEntry("pound")!.baseFactor
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Producto de prueba",
                    // percentage:100/baseFactor:1 arbitrarios -- este test no asegura rawMaterialCost.
                    productRawMaterials: [{ rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "X", costPerUnit: 1, costUnit: { unitType: "weight", baseFactor: 1 } } }]
                },
                sizePresentation: { displayLabel: "Presentación", netWeightGrams: GRAMS_PER_POUND * 10 }, // 10 lb por unidad, 1 unidad
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
            mockProcessingCostFindAll.mockResolvedValue([
                { id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [] },
                { id: 2, displayName: "Análisis de laboratorio", value: 0.2, calculationType: "per_weight", translations: [] },
                { id: 3, displayName: "Mantenimiento", value: 0.05, calculationType: "per_weight", translations: [] }
            ])

            const result = await quoteService.calculateQuote(baseInput)

            // 10 libras * cada costo: 0.1*10=1, 0.2*10=2, 0.05*10=0.5 -> total exacto 3.5
            expect(result.breakdown.processingCosts.map(line => line.lineTotal)).toEqual([1, 2, 0.5])
            expect(result.processingCostTotal).toBe(3.5)
        })

        it("excluye una fila 'percentage' de la respuesta aunque el catálogo la devuelva junto a filas 'per_weight' (defensa en profundidad: quote.service.ts vuelve a validar calculationType en código, no confía solo en el filtro WHERE de la query)", async () => {
            stubVariantForProcessingCosts(2000)
            // Simula qué pasaría si la query alguna vez dejara de filtrar por calculationType (ej.
            // un refactor futuro que solo filtre por isActive) -- el mock, a diferencia de Postgres,
            // no aplica el WHERE por sí solo, así que esto reproduce ese escenario a propósito.
            mockProcessingCostFindAll.mockResolvedValue([
                { id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [] },
                { id: 2, displayName: "Contingencia 2%", value: 2, calculationType: "percentage", translations: [] }
            ])

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.breakdown.processingCosts.map(line => line.processingCostId)).toEqual([1])
        })

        it("con el catálogo vacío, el total es IDÉNTICO al comportamiento histórico de antes de esta feature (regresión de compatibilidad hacia atrás)", async () => {
            stubVariantForProcessingCosts(2000)
            mockProcessingCostFindAll.mockResolvedValue([])

            const result = await quoteService.calculateQuote(baseInput)

            // rawMaterialCost(200) + unitPackagingCost(20) + transportCost(50), con un material de palet de
            // costo $0 (solo para la guarda pallet_materials_not_configured): el total no cambia con el catálogo
            // de costos adicionales vacío.
            expect(result.processingCostTotal).toBe(0)
            expect(result.totalCost).toBe(270)
        })

        it("el total incluye TODAS las líneas a la vez (materia prima + empaque unitario + empaque intermedio + costos adicionales + materiales de palet + transporte + ajuste), sumadas y redondeadas correctamente", async () => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- catálogo estático hardcodeado, "pound" siempre existe (ver unitCatalog.ts)
            const GRAMS_PER_POUND = getUnitCatalogEntry("pound")!.baseFactor
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 10,
                bagsPerBox: 1,
                unitsPerIntermediatePackage: 5,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Producto completo",
                    // percentage:100 (única materia prima) + costUnit.baseFactor == netWeightGrams (ambos = 1 lb en
                    // gramos) -> quantityPerUnit = 1 lb.
                    productRawMaterials: [{ rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "X", costPerUnit: 2, costUnit: { unitType: "weight", baseFactor: GRAMS_PER_POUND } } }],
                    additionalCostPerUnit: 0.5
                },
                sizePresentation: { displayLabel: "Bolsa", netWeightGrams: GRAMS_PER_POUND }, // 1 lb por unidad
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa", unitCost: 1 } }],
                intermediateMaterials: [{ id: 60, packagingId: 6, optionGroup: null, isDefault: false, usedIntermediateMaterial: { id: 6, displayName: "Bolsa grande", unitCost: 3 } }],
                palletMaterials: [{ packagingId: 7, quantityValue: 2, usedPalletMaterial: { displayName: "Caja", unitCost: 4 } }]
            })
            mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 1, calculationType: "per_weight", translations: [] }])

            const result = await quoteService.calculateQuote(baseInput) // requestedPallets=1 -> totalUnits = 10

            // rawMaterialCost = costPerUnit(2) * quantityPerUnit(1 lb) * totalUnits(10) = 20
            expect(result.rawMaterialCost).toBe(20)
            // unitPackagingCost = unitCost(1) * totalUnits(10) = 10
            expect(result.unitPackagingCost).toBe(10)
            // intermediatePackagingCost = ceil(10/5)=2 paquetes * unitCost(3) = 6
            expect(result.intermediatePackagingCost).toBe(6)
            // processingCostTotal = 10 unidades * 1lb c/u = 10lb * USD 1/lb = 10
            expect(result.processingCostTotal).toBe(10)
            // palletMaterialCost = unitCost(4) * quantityValue(2) * requestedPallets(1) = 8
            expect(result.palletMaterialCost).toBe(8)
            // transportCost = baseCost del destino stubeado = 50
            expect(result.transportCost).toBe(50)
            // adjustmentCost = additionalCostPerUnit(0.5) * totalUnits(10) = 5
            expect(result.adjustmentCost).toBe(5)
            // totalCost = 20 + 10 + 6 + 10 + 8 + 50 + 5 = 109
            expect(result.totalCost).toBe(109)
        })
    })

    describe("costos adicionales tipo porcentaje (Imprevistos/contingencia, aplicados AL FINAL sobre el subtotal ya escalado)", () => {
        // ProcessingCost.findAll se llama dos veces (per_weight y percentage): el mock inspecciona
        // where.calculationType para devolver la lista correcta a cada llamada.
        function stubProcessingCosts(rows: { perWeight?: unknown[]; percentage?: unknown[] } = {}): void {
            const perWeightRows = rows.perWeight ?? []
            const percentageRows = rows.percentage ?? []
            mockProcessingCostFindAll.mockImplementation(({ where }: { where: { calculationType: string } }) =>
                Promise.resolve(where.calculationType === "percentage" ? percentageRows : perWeightRows)
            )
        }

        // Fixture limpio y "de a mano": 1 palet * 1 unidad/palet (por defecto) = 1 unidad.
        // rawMaterialCost = costPerUnit(1) * quantityPerUnit(100, ver fixture abajo) * totalUnits(1) = 100
        // unitPackagingCost = unitCost(20) * totalUnits(1) = 20
        // palletMaterialCost = unitCost(30) * quantityValue(1) * requestedPallets(1) = 30
        // percentageBase = 100 + 0(sin costos por peso) + 20 + 0(sin empaque intermedio) + 30 = 150
        function stubBaseVariant(boxesPerPallet: number): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Producto de prueba",
                    // percentage:100 + costUnit.baseFactor(0.01) con netWeightGrams(1) da quantityPerUnit 100.
                    productRawMaterials: [{ rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "X", costPerUnit: 1, costUnit: { unitType: "weight", baseFactor: 0.01 } } }]
                },
                sizePresentation: { displayLabel: "Presentación", netWeightGrams: 1 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 20 } }],
                palletMaterials: [{ packagingId: 7, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 30 } }]
            })
        }

        it("aplica el % sobre materia prima + empaque + materiales de palet, EXCLUYE transporte de la base -- valores exactos", async () => {
            stubBaseVariant(1)
            stubProcessingCosts({ percentage: [{ id: 1, displayName: "Imprevistos", value: 2, calculationType: "percentage", translations: [] }] })

            const result = await quoteService.calculateQuote(baseInput) // requestedPallets=1 -> totalUnits=1

            expect(result.rawMaterialCost).toBe(100)
            expect(result.unitPackagingCost).toBe(20)
            expect(result.palletMaterialCost).toBe(30)
            // percentageBase = 100 + 20 + 30 = 150 (transporte NO entra -- ver siguiente expect)
            expect(result.breakdown.percentageCosts).toEqual([
                expect.objectContaining({ processingCostId: 1, displayName: "Imprevistos", value: 2, baseAmount: 150, lineTotal: 3 })
            ])
            expect(result.percentageCostTotal).toBe(3) // 150 * 2 / 100
            expect(result.transportCost).toBe(50) // el destino stubeado, fuera de la base
            // totalCost = base(150) + percentage(3) + transporte(50) = 203
            expect(result.totalCost).toBe(203)
        })

        it("se calcula sobre el subtotal YA ESCALADO a varios palets, no sobre un monto por unidad sin escalar", async () => {
            stubBaseVariant(1)
            stubProcessingCosts({ percentage: [{ id: 1, displayName: "Imprevistos", value: 2, calculationType: "percentage", translations: [] }] })

            const result = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 5 }) // totalUnits = 5

            // Cada línea de la base escala x5 frente al test anterior (1 palet):
            expect(result.rawMaterialCost).toBe(500) // 100 * 5
            expect(result.unitPackagingCost).toBe(100) // 20 * 5
            expect(result.palletMaterialCost).toBe(150) // 30 * 5
            // percentageBase = 500 + 100 + 150 = 750 (= 150 * 5, la base también escala completa)
            expect(result.breakdown.percentageCosts[0]).toEqual(
                expect.objectContaining({ baseAmount: 750, lineTotal: 15 }) // 750 * 2 / 100 = 15
            )
            expect(result.percentageCostTotal).toBe(15)
            expect(result.transportCost).toBe(50) // el transporte NO escala con palets, sigue siendo el mismo baseCost fijo
            // totalCost = 750 + 15 + 50 = 815
            expect(result.totalCost).toBe(815)
        })

        it("varias filas 'percentage' activas se SUMAN sobre la misma base, no se componen/encadenan", async () => {
            stubBaseVariant(1)
            stubProcessingCosts({
                percentage: [
                    { id: 1, displayName: "Imprevistos", value: 2, calculationType: "percentage", translations: [] },
                    { id: 2, displayName: "Utilidad", value: 5, calculationType: "percentage", translations: [] }
                ]
            })

            const result = await quoteService.calculateQuote(baseInput)

            // Base = 150 (igual que el primer test). Sumado: 150*2/100 + 150*5/100 = 3 + 7.5 = 10.5.
            // Si se compusiera en cadena (150*1.02*1.05 - 150 = 10.65) el resultado sería distinto
            // -- este valor exacto (10.5, no 10.65) es justo lo que distingue "sumado" de "compuesto".
            expect(result.breakdown.percentageCosts.map(line => line.lineTotal)).toEqual([3, 7.5])
            expect(result.percentageCostTotal).toBe(10.5)
            expect(result.totalCost).toBe(150 + 10.5 + 50) // 210.5
        })

        it("una fila 'per_weight' que se cuele en la respuesta de la query de 'percentage' NO se calcula como porcentaje (defensa en profundidad simétrica a la de per_weight)", async () => {
            stubBaseVariant(1)
            stubProcessingCosts({
                percentage: [
                    { id: 1, displayName: "Energía", value: 0.1, calculationType: "per_weight", translations: [] },
                    { id: 2, displayName: "Imprevistos", value: 2, calculationType: "percentage", translations: [] }
                ]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.breakdown.percentageCosts.map(line => line.processingCostId)).toEqual([2])
        })

        it("con el catálogo de 'percentage' vacío, el comportamiento es IDÉNTICO al de antes de esta feature (regresión)", async () => {
            stubBaseVariant(1)
            stubProcessingCosts() // sin filas de ningún tipo

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.percentageCostTotal).toBe(0)
            expect(result.breakdown.percentageCosts).toEqual([])
            expect(result.totalCost).toBe(200) // base(150) + transporte(50), sin percentage ni per_weight
        })

        it("una cotización ya guardada NO cambia retroactivamente cuando el catálogo de porcentajes se edita/desactiva después (snapshot congelado)", async () => {
            stubBaseVariant(1)
            stubProcessingCosts({ percentage: [{ id: 1, displayName: "Imprevistos", value: 2, calculationType: "percentage", translations: [] }] })
            mockQuoteCreate.mockResolvedValueOnce({ id: 1, get: () => new Date("2026-01-01T00:00:00Z") })

            const quote1 = await quoteService.saveQuote(42, { productVariantId: 10, destinationId: 900, requestedPallets: 1 })
            expect(quote1.percentageCostTotal).toBe(3)

            // El admin ahora desactiva "Imprevistos" (catálogo cambia) y se cotiza un pedido NUEVO.
            stubProcessingCosts() // ninguna fila activa de ningún tipo
            mockQuoteCreate.mockResolvedValueOnce({ id: 2, get: () => new Date("2026-01-02T00:00:00Z") })

            const quote2 = await quoteService.saveQuote(42, { productVariantId: 10, destinationId: 900, requestedPallets: 1 })
            expect(quote2.percentageCostTotal).toBe(0)

            // Lo que YA se persistió en la primera llamada sigue con el valor congelado (USD 3).
            expect(mockQuoteCreate.mock.calls[0][0]).toMatchObject({ percentageCostTotal: 3 })
            expect(mockQuoteCreate.mock.calls[1][0]).toMatchObject({ percentageCostTotal: 0 })
            expect(quote1.percentageCostTotal).toBe(3)
            expect(quote1.breakdown.percentageCosts).toEqual([expect.objectContaining({ processingCostId: 1, lineTotal: 3 })])
        })
    })

    describe("receta fija validada por % (pivote 2026-09-19): el admin fija el %, el cliente nunca lo puede alterar", () => {
        it("rechaza si los % de una receta fija no suman 100 (± 0.5) -- producto mal configurado, error distinto al del mix", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 40, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } } },
                        { rawMaterialId: 2, percentage: 50, usedRawMaterial: { displayName: "Fresa", costPerUnit: 15, costUnit: { unitType: "weight", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({
                key: "errors.fixed_recipe_percentage_must_total_100"
            })
        })

        it("acepta el borde exacto de la tolerancia (±0.5) igual que el mix personalizable", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 40, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } } },
                        { rawMaterialId: 2, percentage: 59.5, usedRawMaterial: { displayName: "Fresa", costPerUnit: 15, costUnit: { unitType: "weight", baseFactor: 1000 } } } // suma 99.5
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.totalCost).toBeGreaterThan(0)
        })

        it("calcula correctamente un producto fijo de una sola materia prima al 100% (ej. piña congelada 100% piña)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            // 100% * 2000g / 1000(g por kg) = 2kg; costPerUnit(20/kg) * 2kg * totalUnits(1) = 40
            expect(result.rawMaterialCost).toBe(40)
        })

        it("calcula correctamente un mix fijo de dos materias primas que sí suman 100% (ej. banano 50% + fresa 50%)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 50, usedRawMaterial: { displayName: "Banano", costPerUnit: 10, costUnit: { unitType: "weight", baseFactor: 1000 } } },
                        { rawMaterialId: 2, percentage: 50, usedRawMaterial: { displayName: "Fresa", costPerUnit: 30, costUnit: { unitType: "weight", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            // Banano: 50%*2000g/1000=1kg * USD 10 = 10. Fresa: 50%*2000g/1000=1kg * USD 30 = 30. Total 40.
            expect(result.rawMaterialCost).toBe(40)
        })

        it("rechaza si el costUnit de una materia prima de receta fija no es de peso -- mismo guard que ya tenía el mix personalizable", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "volume", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({
                key: "errors.raw_material_cost_unit_type_mismatch"
            })
        })

        it("rechaza si a una materia prima de receta fija le falta costUnit (mismo guard que el mix personalizable)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: null } }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({
                key: "errors.raw_material_missing_cost_unit"
            })
        })

        it("ignora un rawMaterialMix enviado por el cliente en un producto de receta fija -- el cliente nunca puede alterar una receta fija", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            // Un rawMaterialMix "malicioso" que ni siquiera referencia una materia prima real del
            // producto -- si el motor alguna vez llegara a leerlo, esto reventaría con
            // errors.raw_material_not_in_pool. Que NO reviente y dé el mismo costo que sin mix es
            // la prueba de que el mix se ignora por completo en la rama fija.
            const result = await quoteService.calculateQuote({
                ...baseInput,
                rawMaterialMix: [{ rawMaterialId: 999, percentage: 100 }]
            })

            expect(result.rawMaterialCost).toBe(40) // igual que el test "100% piña" de arriba
        })
    })

    describe("empaque intermedio (bolsa grande que agrupa varias unidades, ej. bolsitas dentro de una bolsa grande)", () => {
        function stubVariantWithIntermediatePackaging(unitsPerIntermediatePackage: number | null): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                unitsPerIntermediatePackage,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Snack en Porciones",
                    productRawMaterials: [
                        { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 200 } } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsita 100g", netWeightGrams: 100 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsita individual", unitCost: 1 } }],
                intermediateMaterials: [{ id: 80, packagingId: 8, optionGroup: null, isDefault: false, usedIntermediateMaterial: { id: 8, displayName: "Bolsa grande", unitCost: 3 } }],
                palletMaterials: [
                    { packagingId: 6, quantityValue: 10, usedPalletMaterial: { displayName: "Caja corrugada", unitCost: 1 } }
                ]
            })
        }

        it("calcula el costo del empaque intermedio dividiendo totalUnits entre unitsPerIntermediatePackage y lo suma al total", async () => {
            // totalUnits = 20 (1 palet * 20 unidades/palet), 10 bolsitas por bolsa grande -> 2 bolsas grandes exactas
            stubVariantWithIntermediatePackaging(10)

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.breakdown.intermediateMaterials).toHaveLength(1)
            expect(result.breakdown.intermediateMaterials[0]).toMatchObject({
                packagingId: 8,
                displayName: "Bolsa grande",
                unitCost: 3,
                unitsPerPackage: 10,
                totalUnits: 20,
                packagesNeeded: 2
            })
            expect(result.intermediatePackagingCost).toBe(6) // 3 * 2
            // rawMaterialCost(200) + unitPackagingCost(20) + intermediatePackagingCost(6) + palletMaterialCost(10) + transportCost(50)
            expect(result.totalCost).toBe(286)
        })

        it("redondea hacia arriba (ceil) cuando totalUnits no es múltiplo exacto de unitsPerIntermediatePackage -- no se compra una fracción de bolsa grande", async () => {
            // totalUnits = 20, 7 bolsitas por bolsa grande -> 20/7 = 2.857... debe comprar 3 bolsas grandes, no 2.857
            stubVariantWithIntermediatePackaging(7)

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.breakdown.intermediateMaterials[0].packagesNeeded).toBe(3)
            expect(result.intermediatePackagingCost).toBe(9) // 3 * 3
        })

        it("rechaza si la variante tiene empaque intermedio pero no unitsPerIntermediatePackage (dato viejo/incompleto, no asume nada en silencio)", async () => {
            stubVariantWithIntermediatePackaging(null)

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.intermediate_packaging_missing_units" })
        })
    })

    describe("grupos de opciones -- empaque individual", () => {
        // Fija "Etiqueta" + grupo "Bolsa" (estándar default / con logo) + grupo "Tapa" (simple
        // default / premium). totalUnits = 10 con baseInput (1 palet × 10 × 1).
        function stubVariantWithUnitGroups(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 10,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [
                    { id: 500, packagingId: 5, quantityPerUnit: 1, optionGroup: null, isDefault: false, usedUnitMaterial: { id: 5, displayName: "Etiqueta", unitCost: 1 } },
                    { id: 501, packagingId: 20, quantityPerUnit: 1, optionGroup: "Bolsa", isDefault: true, usedUnitMaterial: { id: 20, displayName: "Bolsa estándar", unitCost: 2 } },
                    { id: 502, packagingId: 21, quantityPerUnit: 1, optionGroup: "Bolsa", isDefault: false, usedUnitMaterial: { id: 21, displayName: "Bolsa con logo", unitCost: 5 } },
                    { id: 503, packagingId: 22, quantityPerUnit: 1, optionGroup: "Tapa", isDefault: true, usedUnitMaterial: { id: 22, displayName: "Tapa simple", unitCost: 3 } },
                    { id: 504, packagingId: 23, quantityPerUnit: 1, optionGroup: "Tapa", isDefault: false, usedUnitMaterial: { id: 23, displayName: "Tapa premium", unitCost: 8 } }
                ],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
        }

        it("sin selección costea las filas fijas + el default de CADA grupo (dos grupos coexisten, no se pisan)", async () => {
            stubVariantWithUnitGroups()

            const result = await quoteService.calculateQuote(baseInput)

            // (fija 1 + Bolsa default 2 + Tapa default 3) * totalUnits(10) = 60
            expect(result.unitPackagingCost).toBe(60)
            expect(result.breakdown.unitMaterials.map(line => line.packagingId)).toEqual([5, 20, 22])
        })

        it("elegir en un grupo y omitir el otro: se costea lo elegido + el default del grupo omitido", async () => {
            stubVariantWithUnitGroups()

            const result = await quoteService.calculateQuote({ ...baseInput, selectedUnitMaterialIds: [502] })

            // (fija 1 + Bolsa con logo 5 + Tapa default 3) * 10 = 90
            expect(result.unitPackagingCost).toBe(90)
            expect(result.breakdown.unitMaterials.map(line => line.packagingId)).toEqual([5, 21, 22])
        })

        it("elegir en ambos grupos costea una fila por grupo", async () => {
            stubVariantWithUnitGroups()

            const result = await quoteService.calculateQuote({ ...baseInput, selectedUnitMaterialIds: [504, 502] })

            // (fija 1 + 5 + 8) * 10 = 140
            expect(result.unitPackagingCost).toBe(140)
            expect(result.breakdown.unitMaterials.map(line => line.packagingId)).toEqual([5, 21, 23])
        })

        it("rechaza dos ids del MISMO grupo (422, nombra el grupo) -- nunca costea ambos ni elige uno en silencio", async () => {
            stubVariantWithUnitGroups()

            await expect(
                quoteService.calculateQuote({ ...baseInput, selectedUnitMaterialIds: [501, 502] })
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.duplicate_material_group_selection", params: { group: "Bolsa" } })
        })

        it("rechaza un id que no pertenece a este SKU (422)", async () => {
            stubVariantWithUnitGroups()

            await expect(
                quoteService.calculateQuote({ ...baseInput, selectedUnitMaterialIds: [999] })
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.invalid_unit_material_selection", params: { selectedId: 999 } })
        })

        it("rechaza el id de una fila FIJA pasado como selección -- no es una opción real", async () => {
            stubVariantWithUnitGroups()

            await expect(
                quoteService.calculateQuote({ ...baseInput, selectedUnitMaterialIds: [500] })
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.invalid_unit_material_selection" })
        })

        it("rechaza un id de OTRO nivel (una fila de paletización mandada como unit) -- los ids solo valen dentro de su tabla", async () => {
            stubVariantWithUnitGroups()

            await expect(
                quoteService.calculateQuote({ ...baseInput, selectedUnitMaterialIds: [600] })
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.invalid_unit_material_selection" })
        })

        it("revienta si un grupo no tiene default ni selección (422, nombra el grupo) aunque los demás grupos estén bien", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 10,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [
                    { id: 501, packagingId: 20, quantityPerUnit: 1, optionGroup: "Bolsa", isDefault: true, usedUnitMaterial: { id: 20, displayName: "Bolsa A", unitCost: 2 } },
                    { id: 503, packagingId: 22, quantityPerUnit: 1, optionGroup: "Tapa", isDefault: false, usedUnitMaterial: { id: 22, displayName: "Tapa A", unitCost: 3 } },
                    { id: 504, packagingId: 23, quantityPerUnit: 1, optionGroup: "Tapa", isDefault: false, usedUnitMaterial: { id: 23, displayName: "Tapa B", unitCost: 8 } }
                ],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({
                statusCode: 422,
                key: "errors.unit_material_default_not_configured",
                params: { group: "Tapa" },
            })
        })

        it("nombres de grupo que solo difieren en mayúsculas/espacios son UN solo grupo (el motor agrupa por la clave normalizada)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 10,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [
                    { id: 501, packagingId: 20, quantityPerUnit: 1, optionGroup: "Bolsa", isDefault: true, usedUnitMaterial: { id: 20, displayName: "Bolsa A", unitCost: 2 } },
                    { id: 502, packagingId: 21, quantityPerUnit: 1, optionGroup: " bolsa  ", isDefault: false, usedUnitMaterial: { id: 21, displayName: "Bolsa B", unitCost: 5 } }
                ],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const defaultResult = await quoteService.calculateQuote(baseInput)
            expect(defaultResult.unitPackagingCost).toBe(20) // solo el default, no ambas filas
            await expect(
                quoteService.calculateQuote({ ...baseInput, selectedUnitMaterialIds: [501, 502] })
            ).rejects.toMatchObject({ key: "errors.duplicate_material_group_selection" })
        })

        it("el snapshot tiene una línea por grupo con su optionGroup congelado (null en la fija)", async () => {
            stubVariantWithUnitGroups()

            const result = await quoteService.calculateQuote({ ...baseInput, selectedUnitMaterialIds: [502] })

            expect(result.breakdown.unitMaterials).toEqual([
                expect.objectContaining({ packagingId: 5, displayName: "Etiqueta", optionGroup: null }),
                expect.objectContaining({ packagingId: 21, displayName: "Bolsa con logo", optionGroup: "Bolsa" }),
                expect.objectContaining({ packagingId: 22, displayName: "Tapa simple", optionGroup: "Tapa" })
            ])
        })

        it("dos cálculos con selecciones distintas dan breakdowns independientes", async () => {
            stubVariantWithUnitGroups()
            const defaultResult = await quoteService.calculateQuote(baseInput)

            stubVariantWithUnitGroups()
            const altResult = await quoteService.calculateQuote({ ...baseInput, selectedUnitMaterialIds: [502, 504] })

            expect(defaultResult.unitPackagingCost).toBe(60)
            expect(altResult.unitPackagingCost).toBe(140)
            expect(defaultResult.breakdown.unitMaterials).not.toEqual(altResult.breakdown.unitMaterials)
        })
    })

    describe("grupos de opciones -- materiales de paletización (caja + esquinero)", () => {
        function stubVariantWithPalletGroups(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 10,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ id: 500, packagingId: 5, quantityPerUnit: 1, optionGroup: null, isDefault: false, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [
                    { id: 600, packagingId: 6, quantityValue: 1, optionGroup: null, isDefault: false, usedPalletMaterial: { displayName: "Film", unitCost: 1 } },
                    { id: 601, packagingId: 22, quantityValue: 2, optionGroup: "Caja", isDefault: true, usedPalletMaterial: { displayName: "Caja de envío", unitCost: 4 } },
                    { id: 602, packagingId: 23, quantityValue: 2, optionGroup: "Caja", isDefault: false, usedPalletMaterial: { displayName: "Caja de estante", unitCost: 9 } },
                    { id: 603, packagingId: 24, quantityValue: 4, optionGroup: "Esquinero", isDefault: true, usedPalletMaterial: { displayName: "Esquinero de cartón", unitCost: 0.5 } },
                    { id: 604, packagingId: 25, quantityValue: 4, optionGroup: "Esquinero", isDefault: false, usedPalletMaterial: { displayName: "Esquinero de madera", unitCost: 2 } }
                ]
            })
        }

        it("sin selección costea film + caja default + esquinero default", async () => {
            stubVariantWithPalletGroups()

            const result = await quoteService.calculateQuote(baseInput) // requestedPallets = 1

            // film 1*1 + caja 4*2 + esquinero 0.5*4 = 1 + 8 + 2 = 11
            expect(result.palletMaterialCost).toBe(11)
        })

        it("elegir el esquinero de madera NO descarta la caja -- la orden lleva caja Y esquinero", async () => {
            stubVariantWithPalletGroups()

            const result = await quoteService.calculateQuote({ ...baseInput, selectedPalletMaterialIds: [604] })

            // film 1 + caja default 8 + esquinero madera 2*4 = 17
            expect(result.palletMaterialCost).toBe(17)
            expect(result.breakdown.palletMaterials.map(line => line.displayName)).toEqual(["Film", "Caja de envío", "Esquinero de madera"])
        })

        it("rechaza un id de paletización que no pertenece a este SKU (422)", async () => {
            stubVariantWithPalletGroups()

            await expect(
                quoteService.calculateQuote({ ...baseInput, selectedPalletMaterialIds: [999] })
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.invalid_pallet_material_selection" })
        })

        it("rechaza caja de envío + caja de estante juntas (mismo grupo)", async () => {
            stubVariantWithPalletGroups()

            await expect(
                quoteService.calculateQuote({ ...baseInput, selectedPalletMaterialIds: [601, 602] })
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.duplicate_material_group_selection", params: { group: "Caja" } })
        })
    })

    describe("explicit pallet consumption and catalog alternatives", () => {
        function stubRecipe(boxesPerPallet = 10, bagsPerBox = 1) {
            const material = (id: number, groupId: number | null, basis: string, quantity: number, cost: number, isDefault = false) => ({
                id, packagingId: id, optionGroupId: groupId, optionGroup: groupId === null ? null : `Renamed ${groupId}`,
                quantityBasis: basis, quantityValue: quantity, isDefault,
                usedPalletMaterial: { displayName: `Packaging ${id}`, unitCost: cost },
            })
            mockVariantFindOne.mockResolvedValue({
                id: 10, boxesPerPallet, bagsPerBox,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ id: 500, packagingId: 5, quantityPerUnit: 1, optionGroup: null, isDefault: false, usedUnitMaterial: { displayName: "Unit", unitCost: 0 } }],
                palletMaterials: [material(600, null, "per_pallet", 1, 10), material(605, null, "per_pallet", 93.3, 0.1),
                    material(601, 4, "per_box", 1, 4, true), material(602, 4, "per_box", 1, 9),
                    material(603, 5, "per_pallet", 4, 0.5, true), material(604, 5, "per_pallet", 4, 2)],
            })
        }
        it("changes box and corner costs while retaining all consumption rules", async () => {
            stubRecipe()
            const defaults = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 2 })
            const selected = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 2, selectedPalletMaterialIds: [602, 604] })
            expect(defaults.palletMaterialCost).toBe(122.66)
            expect(selected.palletMaterialCost).toBe(234.66)
            expect(selected.breakdown.palletMaterials.map(line => line.quantityPerPallet)).toEqual([1, 10, 4, 93.3])
            expect(selected.breakdown.palletMaterials.map(line => line.packagingId)).toEqual([600, 602, 604, 605])
            expect(defaults.breakdown.palletMaterials.map(line => line.quantityPerPallet)).toEqual([1, 10, 4, 93.3])
        })
        it("matches the 40 boxes ? 12 units ? 2 pallets example for both alternatives", async () => {
            stubRecipe(40, 12)
            const defaults = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 2 })
            const selected = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 2, selectedPalletMaterialIds: [602, 604] })
            for (const result of [defaults, selected]) {
                expect(result.totalUnits).toBe(960)
                expect(result.breakdown.unitMaterials[0]).toMatchObject({ quantityPerUnit: 1, totalUnits: 960 })
                expect(result.breakdown.palletMaterials.map(line => line.quantityPerPallet * line.requestedPallets)).toEqual([2, 80, 8, 186.6])
            }
            expect(defaults.breakdown.palletMaterials.map(line => line.packagingId)).toEqual([600, 601, 603, 605])
            expect(selected.breakdown.palletMaterials.map(line => line.packagingId)).toEqual([600, 602, 604, 605])
        })
        it("box count affects only per_box materials regardless of labels", async () => {
            stubRecipe(20)
            const result = await quoteService.calculateQuote(baseInput)
            expect(result.palletMaterialCost).toBe(101.33)
            expect(result.breakdown.palletMaterials.map(line => line.quantityPerPallet)).toEqual([1, 20, 4, 93.3])
        })
        it("catalog defaults do not change quote formulas or saved snapshots", async () => {
            stubRecipe(198, 6)
            const variant = await mockVariantFindOne()
            for (const material of variant.palletMaterials) {
                material.usedPalletMaterial.defaultQuantityBasis = "per_pallet"
                material.usedPalletMaterial.defaultQuantityValue = 999
            }
            mockQuoteCreate.mockResolvedValue({ id: 888, get: () => new Date("2026-10-06T00:00:00Z") })
            const saved = await quoteService.saveQuote(42, { productVariantId: 10, requestedPallets: 2 })
            const persisted = structuredClone(mockQuoteCreate.mock.calls.at(-1)![0])
            const before = JSON.stringify(saved.breakdown)
            expect(saved.totalUnits).toBe(2376)
            expect(saved.breakdown.unitMaterials[0]).toMatchObject({ quantityPerUnit: 1, totalUnits: 2376 })
            expect(saved.breakdown.palletMaterials.map(line => line.quantityPerPallet * line.requestedPallets)).toEqual([2, 396, 8, 186.6])
            for (const material of variant.palletMaterials) material.usedPalletMaterial.defaultQuantityValue = 1000
            const next = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 2 })
            expect(next.palletMaterialCost).toBe(saved.palletMaterialCost)
            expect(JSON.stringify(saved.breakdown)).toBe(before)
            expect(persisted.breakdown).toEqual(saved.breakdown)
            expect(saved.breakdown.palletMaterials.some(line => line.quantityPerPallet === 999)).toBe(false)
        })

    })

    describe("grupos de opciones -- empaque intermedio (nivel multi-fila desde 2026-09-24)", () => {
        function stubVariantWithIntermediateRows(intermediateMaterials: unknown[]): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 10,
                bagsPerBox: 1,
                unitsPerIntermediatePackage: 5,
                parentProduct: { isCustomizable: false, productRawMaterials: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }],
                intermediateMaterials
            })
        }

        const SACO_GROUP = [
            { id: 700, packagingId: 30, optionGroup: "Saco", isDefault: true, usedIntermediateMaterial: { id: 30, displayName: "Saco estándar", unitCost: 3 } },
            { id: 701, packagingId: 31, optionGroup: "Saco", isDefault: false, usedIntermediateMaterial: { id: 31, displayName: "Saco reforzado", unitCost: 7 } }
        ]

        it("usa la alternativa default cuando el cliente no elige -- totalUnits=10, packagesNeeded=ceil(10/5)=2", async () => {
            stubVariantWithIntermediateRows(SACO_GROUP)

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.breakdown.intermediateMaterials).toEqual([
                expect.objectContaining({ packagingId: 30, unitCost: 3, packagesNeeded: 2, optionGroup: "Saco" })
            ])
            expect(result.intermediatePackagingCost).toBe(6) // 3 * 2
        })

        it("elegir una alternativa válida cambia el costo del empaque intermedio", async () => {
            stubVariantWithIntermediateRows(SACO_GROUP)

            const result = await quoteService.calculateQuote({ ...baseInput, selectedIntermediateMaterialIds: [701] })

            expect(result.breakdown.intermediateMaterials).toEqual([expect.objectContaining({ packagingId: 31, unitCost: 7, packagesNeeded: 2 })])
            expect(result.intermediatePackagingCost).toBe(14) // 7 * 2
        })

        it("rechaza un id intermedio que no pertenece a este SKU (422)", async () => {
            stubVariantWithIntermediateRows(SACO_GROUP)

            await expect(
                quoteService.calculateQuote({ ...baseInput, selectedIntermediateMaterialIds: [999] })
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.invalid_intermediate_material_selection" })
        })

        it("revienta si un grupo intermedio no tiene default ni selección (nombra el grupo)", async () => {
            stubVariantWithIntermediateRows(SACO_GROUP.map(row => ({ ...row, isDefault: false })))

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({
                statusCode: 422,
                key: "errors.intermediate_material_default_not_configured",
                params: { group: "Saco" },
            })
        })

        it("varias filas FIJAS + grupos: TODAS las fijas se costean además de la elegida (antes: dos fijas reventaban y una fija con menú se ignoraba)", async () => {
            stubVariantWithIntermediateRows([
                { id: 690, packagingId: 28, optionGroup: null, isDefault: false, usedIntermediateMaterial: { id: 28, displayName: "Cinta de cierre", unitCost: 1 } },
                { id: 691, packagingId: 29, optionGroup: null, isDefault: false, usedIntermediateMaterial: { id: 29, displayName: "Etiqueta de saco", unitCost: 0.5 } },
                ...SACO_GROUP
            ])

            const result = await quoteService.calculateQuote({ ...baseInput, selectedIntermediateMaterialIds: [701] })

            // packagesNeeded = 2 para todas: (1 + 0.5 + 7) * 2 = 17
            expect(result.breakdown.intermediateMaterials.map(line => line.packagingId)).toEqual([28, 29, 31])
            expect(result.intermediatePackagingCost).toBe(17)
        })

        it("sin ninguna fila de grupo, una sola fila fija sigue funcionando como antes", async () => {
            stubVariantWithIntermediateRows([
                { id: 700, packagingId: 30, optionGroup: null, isDefault: false, usedIntermediateMaterial: { id: 30, displayName: "Bolsa grande", unitCost: 3 } }
            ])

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.intermediatePackagingCost).toBe(6) // 3 * ceil(10/5)
        })
    })

    describe("mix personalizable (producto isCustomizable)", () => {
        function stubCustomizableVariant(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    displayName: "Smoothie Personalizado",
                    productRawMaterials: [
                        {
                            rawMaterialId: 1,
                            minPercentage: null,
                            maxPercentage: null,
                            usedRawMaterial: {
                                displayName: "Piña convencional",
                                costPerUnit: 20,
                                costUnit: { unitType: "weight", baseFactor: 1000 }
                            }
                        },
                        {
                            rawMaterialId: 2,
                            minPercentage: null,
                            maxPercentage: null,
                            usedRawMaterial: {
                                displayName: "Piña orgánica",
                                costPerUnit: 15,
                                costUnit: { unitType: "weight", baseFactor: 1000 }
                            }
                        }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa plástica", unitCost: 1 } }],
                palletMaterials: [
                    { packagingId: 6, quantityValue: 10, usedPalletMaterial: { displayName: "Caja corrugada", unitCost: 1 } },
                    { packagingId: 7, quantityValue: 4, usedPalletMaterial: { displayName: "Parales", unitCost: 1 } }
                ]
            })
        }

        // Caso verificado a mano contra el cotizador real en producción -- USD 763.40 exacto. Si
        // este test empieza a
        // fallar, es una señal directa de regresión en el motor de cálculo, no un falso positivo.
        it("reproduce el caso verificado en producción: 40% piña convencional + 59.9% piña orgánica = USD 763.40", async () => {
            stubCustomizableVariant()

            const result = await quoteService.calculateQuote({
                ...baseInput,
                rawMaterialMix: [
                    { rawMaterialId: 1, percentage: 40 },
                    { rawMaterialId: 2, percentage: 59.9 }
                ]
            })

            // Con decimal.js el resultado debe ser exacto; si falla es una regresión de precisión.
            expect(result.rawMaterialCost).toBe(679.4)
            expect(result.unitPackagingCost).toBe(20)
            expect(result.palletMaterialCost).toBe(14)
            expect(result.transportCost).toBe(50)
            expect(result.totalCost).toBe(763.4)
        })

        it("rechaza si no se manda ningún mix", async () => {
            stubCustomizableVariant()

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.raw_material_mix_required" })
        })

        it("rechaza si el mix no suma 100% (fuera de la tolerancia de 0.5)", async () => {
            stubCustomizableVariant()

            await expect(
                quoteService.calculateQuote({
                    ...baseInput,
                    rawMaterialMix: [
                        { rawMaterialId: 1, percentage: 40 },
                        { rawMaterialId: 2, percentage: 50 } // suma 90, desvío de 10
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.mix_percentage_must_total_100" })
        })

        it("acepta el mix justo en el borde de la tolerancia (±0.5)", async () => {
            stubCustomizableVariant()

            const result = await quoteService.calculateQuote({
                ...baseInput,
                rawMaterialMix: [
                    { rawMaterialId: 1, percentage: 40 },
                    { rawMaterialId: 2, percentage: 59.5 } // suma 99.5, desvío exacto de 0.5
                ]
            })

            expect(result.totalCost).toBeGreaterThan(0)
        })

        it("reconcilia exacto (sin diferencia de precisión) con un mix de 3 materias primas en tercios (33.34/33.33/33.33) -- caso clásico de arrastre de error en floats nativos", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    displayName: "Mix de tercios",
                    productRawMaterials: [
                        { rawMaterialId: 1, minPercentage: null, maxPercentage: null, usedRawMaterial: { displayName: "A", costPerUnit: 17.37, costUnit: { unitType: "weight", baseFactor: 1000 } } },
                        { rawMaterialId: 2, minPercentage: null, maxPercentage: null, usedRawMaterial: { displayName: "B", costPerUnit: 9.21, costUnit: { unitType: "weight", baseFactor: 1000 } } },
                        { rawMaterialId: 3, minPercentage: null, maxPercentage: null, usedRawMaterial: { displayName: "C", costPerUnit: 23.05, costUnit: { unitType: "weight", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote({
                ...baseInput,
                requestedPallets: 7,
                rawMaterialMix: [
                    { rawMaterialId: 1, percentage: 33.34 },
                    { rawMaterialId: 2, percentage: 33.33 },
                    { rawMaterialId: 3, percentage: 33.33 }
                ]
            })

            // El total debe ser EXACTAMENTE la suma de los lineTotal ya redondeados que se
            // muestran en el breakdown -- ni una diferencia de precisión entre lo que ve el
            // cliente línea por línea y el subtotal/total que se guarda en las columnas DECIMAL
            // (4 decimales, ver MONEY_DECIMALS en money.util.ts). El `* 10000 / 10000` de abajo
            // no es la regla de negocio -- es solo para neutralizar el ruido de floats nativos
            // del `reduce` con `+` de esta línea (a propósito, para no depender de decimal.js
            // acá y probar el dato tal como lo vería un consumidor externo del JSON).
            const sumOfLines = result.breakdown.rawMaterials.reduce((sum, line) => sum + line.lineTotal, 0)
            expect(Math.round(sumOfLines * 10000) / 10000).toBe(result.rawMaterialCost)
            expect(result.totalCost).toBe(result.rawMaterialCost + result.transportCost)
        })

        it("rechaza un desvío de 0.51 por encima de la tolerancia (borde exclusivo)", async () => {
            stubCustomizableVariant()

            await expect(
                quoteService.calculateQuote({
                    ...baseInput,
                    rawMaterialMix: [
                        { rawMaterialId: 1, percentage: 40 },
                        { rawMaterialId: 2, percentage: 59.49 } // suma 99.49, desvío de 0.51
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.mix_percentage_must_total_100" })
        })

        it("rechaza una materia prima duplicada en el mix", async () => {
            stubCustomizableVariant()

            await expect(
                quoteService.calculateQuote({
                    ...baseInput,
                    rawMaterialMix: [
                        { rawMaterialId: 1, percentage: 50 },
                        { rawMaterialId: 1, percentage: 50 }
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.duplicate_raw_material_in_mix" })
        })

        it("rechaza una materia prima que no está en el pool del producto", async () => {
            stubCustomizableVariant()

            await expect(
                quoteService.calculateQuote({
                    ...baseInput,
                    rawMaterialMix: [
                        { rawMaterialId: 999, percentage: 100 }
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.raw_material_not_in_pool" })
        })

        it("rechaza un porcentaje fuera de los límites min/max que puso el admin", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productRawMaterials: [
                        {
                            rawMaterialId: 1,
                            minPercentage: 20,
                            maxPercentage: 30,
                            usedRawMaterial: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } }
                        }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, rawMaterialMix: [{ rawMaterialId: 1, percentage: 80 }] })
            ).rejects.toMatchObject({ key: "errors.raw_material_percentage_out_of_range" })
        })

        it("acepta un porcentaje justo en el borde inclusivo del límite min/max (no lo rechaza por ser el borde)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productRawMaterials: [
                        {
                            rawMaterialId: 1,
                            minPercentage: 20,
                            maxPercentage: 30,
                            usedRawMaterial: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } }
                        },
                        {
                            rawMaterialId: 2,
                            minPercentage: null,
                            maxPercentage: null,
                            usedRawMaterial: { costPerUnit: 10, costUnit: { unitType: "weight", baseFactor: 1000 } }
                        }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            // percentage=20 es exactamente minPercentage -- la condición es `< min || > max`, así
            // que el borde debe aceptarse, no rechazarse.
            const result = await quoteService.calculateQuote({
                ...baseInput,
                rawMaterialMix: [
                    { rawMaterialId: 1, percentage: 20 },
                    { rawMaterialId: 2, percentage: 80 }
                ]
            })

            expect(result.totalCost).toBeGreaterThan(0)
        })

        it("cuando el admin solo puso maxPercentage (minPercentage null), el mínimo real queda en 0", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productRawMaterials: [
                        {
                            rawMaterialId: 1,
                            minPercentage: null,
                            maxPercentage: 50,
                            usedRawMaterial: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } }
                        },
                        {
                            rawMaterialId: 2,
                            minPercentage: null,
                            maxPercentage: null,
                            usedRawMaterial: { costPerUnit: 10, costUnit: { unitType: "weight", baseFactor: 1000 } }
                        }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            // percentage=1 (casi 0) debe aceptarse -- min real es 0, no hay piso implícito.
            const result = await quoteService.calculateQuote({
                ...baseInput,
                rawMaterialMix: [
                    { rawMaterialId: 1, percentage: 1 },
                    { rawMaterialId: 2, percentage: 99 }
                ]
            })
            expect(result.totalCost).toBeGreaterThan(0)

            // percentage=51 (por encima de maxPercentage=50) debe rechazarse.
            await expect(
                quoteService.calculateQuote({
                    ...baseInput,
                    rawMaterialMix: [
                        { rawMaterialId: 1, percentage: 51 },
                        { rawMaterialId: 2, percentage: 49 }
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.raw_material_percentage_out_of_range" })
        })

        it("cuando el admin solo puso minPercentage (maxPercentage null), el máximo real queda en 100", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productRawMaterials: [
                        {
                            rawMaterialId: 1,
                            minPercentage: 50,
                            maxPercentage: null,
                            usedRawMaterial: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } }
                        }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            // percentage=100 (por encima del min pero sin tope explícito) debe aceptarse -- max
            // real es 100, no hay techo implícito.
            const result = await quoteService.calculateQuote({
                ...baseInput,
                rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }]
            })
            expect(result.totalCost).toBeGreaterThan(0)

            // percentage=49 (por debajo de minPercentage=50) debe rechazarse.
            await expect(
                quoteService.calculateQuote({ ...baseInput, rawMaterialMix: [{ rawMaterialId: 1, percentage: 49 }] })
            ).rejects.toMatchObject({ key: "errors.raw_material_percentage_out_of_range" })
        })

        it("rechaza si a la materia prima le falta costUnit (bug histórico: costos 'en millones')", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productRawMaterials: [
                        { rawMaterialId: 1, minPercentage: null, maxPercentage: null, usedRawMaterial: { costPerUnit: 20, costUnit: null } }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }] })
            ).rejects.toMatchObject({ key: "errors.raw_material_missing_cost_unit" })
        })

        it("rechaza si el costUnit de la materia prima no es de peso (bug histórico: unitType no validado)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productRawMaterials: [
                        {
                            rawMaterialId: 1,
                            minPercentage: null,
                            maxPercentage: null,
                            usedRawMaterial: { costPerUnit: 20, costUnit: { unitType: "volume", baseFactor: 1000 } }
                        }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }] })
            ).rejects.toMatchObject({ key: "errors.raw_material_cost_unit_type_mismatch" })
        })

        it("rechaza si la presentación no tiene netWeightGrams", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productRawMaterials: [
                        { rawMaterialId: 1, minPercentage: null, maxPercentage: null, usedRawMaterial: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: null },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100 }] })
            ).rejects.toMatchObject({ key: "errors.presentation_missing_net_weight" })
        })
    })

    describe("ingredientes agregados (sal, azúcar...) -- línea aparte, fuera del 100% de la receta", () => {
        // Libra REAL del catálogo (igual que el resto del archivo) -- Ingredient.costUnit siempre es
        // la Libra forzada (ingredient.service.ts), y la materia prima de estos fixtures también.
        const POUND_UNIT = { unitType: "weight", baseFactor: getUnitCatalogEntry("pound")!.baseFactor }

        // Ejemplo trabajado: sal a $0.50/lb, "40 g en una presentación de
        // 2000 g" (= 2% del peso neto), cotizada en una presentación de 500 g -> 10 g por unidad.
        const SAL = {
            id: 1,
            ingredientId: 50,
            grams: "40.000", // DECIMAL llega como string desde Postgres -- el motor debe castear
            referenceNetWeightGrams: "2000.00",
            usedIngredient: { displayName: "Sal", costPerUnit: "0.5000", costUnit: POUND_UNIT, translations: [{ language: "en", displayName: "Salt" }] }
        }
        const AZUCAR = {
            id: 2,
            ingredientId: 51,
            grams: 100,
            referenceNetWeightGrams: 2000,
            usedIngredient: { displayName: "Azúcar", costPerUnit: 0.75, costUnit: POUND_UNIT, translations: [] }
        }

        const MANGO_100 = [{ rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Mango", costPerUnit: 1, costUnit: POUND_UNIT } }]

        // 60 cajas × 12 bolsas = 720 unidades por palet.
        function stubIngredientVariant(options: {
            netWeightGrams?: number | null
            productIngredients?: unknown[]
            productRawMaterials?: unknown[]
            isCustomizable?: boolean
        } = {}): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 60,
                bagsPerBox: 12,
                parentProduct: {
                    isCustomizable: options.isCustomizable ?? false,
                    displayName: "Mango deshidratado",
                    productRawMaterials: options.productRawMaterials ?? MANGO_100,
                    productIngredients: options.productIngredients ?? [SAL]
                },
                sizePresentation: { displayLabel: "Bolsa", netWeightGrams: options.netWeightGrams === undefined ? 500 : options.netWeightGrams },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa", unitCost: 0.1 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 60, usedPalletMaterial: { displayName: "Caja", unitCost: 0.5 } }]
            })
        }

        const input: CalculateQuoteInput = { productVariantId: 10, requestedPallets: 1 }

        it("costea el ejemplo trabajado exacto: 40 g/2000 g de sal a $0.50/lb en 500 g × 720 unidades = $7.9366", async () => {
            stubIngredientVariant()

            const result = await quoteService.calculateQuote(input)

            // 10 g / 453.592 g/lb = 0.0220462 lb × $0.50 × 720 = 7.93664 -> 7.9366 (4 decimales internos)
            expect(result.ingredientCost).toBe(7.9366)
            expect(result.breakdown.ingredients).toEqual([
                {
                    ingredientId: 50,
                    displayName: "Sal",
                    grams: 40,
                    referenceNetWeightGrams: 2000,
                    gramsPerUnit: 10,
                    unitCost: 0.5,
                    quantityPerUnit: 0.022046,
                    totalUnits: 720,
                    lineTotal: 7.9366
                }
            ])
        })

        it("escala con la presentación: el mismo producto en 2000 g cuesta ×4 que en 500 g", async () => {
            stubIngredientVariant({ netWeightGrams: 500 })
            const small = await quoteService.calculateQuote(input)
            stubIngredientVariant({ netWeightGrams: 2000 })
            const large = await quoteService.calculateQuote(input)

            expect(small.breakdown.ingredients[0].gramsPerUnit).toBe(10)
            expect(large.breakdown.ingredients[0].gramsPerUnit).toBe(40) // la presentación de referencia
            // 4 × 7.93664 = 31.74656 -> 31.7466 (redondeo propio de la línea, no 4 × 7.9366)
            expect(large.ingredientCost).toBe(31.7466)
            expect(large.ingredientCost).toBeCloseTo(small.ingredientCost * 4, 3)
        })

        it("sin ingredientes: ingredientCost 0, breakdown.ingredients [] y un total idéntico al de antes", async () => {
            stubIngredientVariant({ productIngredients: [] })

            const result = await quoteService.calculateQuote(input)

            expect(result.ingredientCost).toBe(0)
            expect(result.breakdown.ingredients).toEqual([])
            // raw 500/453.592 × $1 × 720 = 793.6648; bolsa 0.1 × 720 = 72; cajas 60 × 0.5 = 30
            expect(result.totalCost).toBe(895.6648)
        })

        it("no cambia la materia prima: mismo rawMaterialCost con y sin ingredientes, y el total sube exactamente ingredientCost", async () => {
            stubIngredientVariant({ productIngredients: [] })
            const withoutIngredients = await quoteService.calculateQuote(input)
            stubIngredientVariant({ productIngredients: [SAL, AZUCAR] })
            const withIngredients = await quoteService.calculateQuote(input)

            expect(withIngredients.rawMaterialCost).toBe(withoutIngredients.rawMaterialCost)
            expect(withIngredients.breakdown.rawMaterials).toEqual(withoutIngredients.breakdown.rawMaterials)
            // azúcar: 100/2000 = 5% -> 25 g/unidad -> 25/453.592 × 0.75 × 720 = 29.7624
            expect(withIngredients.breakdown.ingredients.map(line => line.lineTotal)).toEqual([7.9366, 29.7624])
            expect(withIngredients.ingredientCost).toBe(37.699)
            expect(withIngredients.totalCost).toBe(withoutIngredients.totalCost + 37.699)
        })

        it("un producto sin materias primas ni ingredientes no exige peso neto; con ingredientes sí (422)", async () => {
            stubIngredientVariant({ productRawMaterials: [], productIngredients: [], netWeightGrams: null })
            await expect(quoteService.calculateQuote(input)).resolves.toMatchObject({ ingredientCost: 0 })

            stubIngredientVariant({ productRawMaterials: [], productIngredients: [SAL], netWeightGrams: null })
            await expect(quoteService.calculateQuote(input)).rejects.toMatchObject({
                statusCode: 422,
                key: "errors.presentation_missing_net_weight"
            })
        })

        it("rechaza un ingrediente sin unidad de costeo con su propia clave de error", async () => {
            stubIngredientVariant({ productIngredients: [{ ...SAL, usedIngredient: { ...SAL.usedIngredient, costUnit: null } }] })

            await expect(quoteService.calculateQuote(input)).rejects.toMatchObject({
                statusCode: 422,
                key: "errors.ingredient_missing_cost_unit",
                params: { ingredientId: 50 }
            })
        })

        it("ingredientCost entra en la base de los costos adicionales tipo porcentaje", async () => {
            stubIngredientVariant()
            mockProcessingCostFindAll.mockImplementation(({ where }: { where: { calculationType: string } }) =>
                Promise.resolve(where.calculationType === "percentage"
                    ? [{ id: 1, displayName: "Imprevistos", value: 10, calculationType: "percentage", translations: [] }]
                    : [])
            )

            const result = await quoteService.calculateQuote(input)

            // base = raw 793.6648 + ingredientes 7.9366 + bolsa 72 + cajas 30 = 903.6014
            expect(result.breakdown.percentageCosts[0].baseAmount).toBe(903.6014)
            expect(result.percentageCostTotal).toBe(90.3601)
        })

        it("receta fija + ingredientes: la receta sigue sumando 100 sin contar el 2% de sal", async () => {
            stubIngredientVariant({
                productRawMaterials: [
                    { rawMaterialId: 1, percentage: 60, usedRawMaterial: { displayName: "Mango", costPerUnit: 1, costUnit: POUND_UNIT } },
                    { rawMaterialId: 2, percentage: 40, usedRawMaterial: { displayName: "Piña", costPerUnit: 1, costUnit: POUND_UNIT } }
                ]
            })

            const result = await quoteService.calculateQuote(input)

            expect(result.breakdown.rawMaterials).toHaveLength(2)
            expect(result.ingredientCost).toBe(7.9366)
        })

        it("receta fija incompleta sigue fallando aunque los ingredientes 'completarían' el 100%", async () => {
            stubIngredientVariant({
                productRawMaterials: [{ rawMaterialId: 1, percentage: 98, usedRawMaterial: { displayName: "Mango", costPerUnit: 1, costUnit: POUND_UNIT } }]
            })

            await expect(quoteService.calculateQuote(input)).rejects.toMatchObject({ key: "errors.fixed_recipe_percentage_must_total_100" })
        })

        describe("producto personalizable", () => {
            const POOL = [
                { rawMaterialId: 1, minPercentage: null, maxPercentage: null, usedRawMaterial: { displayName: "Mango", costPerUnit: 1, costUnit: POUND_UNIT } },
                { rawMaterialId: 2, minPercentage: null, maxPercentage: null, usedRawMaterial: { displayName: "Piña", costPerUnit: 2, costUnit: POUND_UNIT } }
            ]

            it("la mezcla sigue sumando 100 y los ingredientes se cobran encima", async () => {
                stubIngredientVariant({ isCustomizable: true, productRawMaterials: POOL })

                const result = await quoteService.calculateQuote({
                    ...input,
                    rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 2, percentage: 50 }]
                })

                expect(result.breakdown.rawMaterials).toHaveLength(2)
                expect(result.ingredientCost).toBe(7.9366)
            })

            it("una mezcla que no suma 100 se sigue rechazando -- los ingredientes no cuentan para el 100", async () => {
                stubIngredientVariant({ isCustomizable: true, productRawMaterials: POOL })

                await expect(quoteService.calculateQuote({
                    ...input,
                    rawMaterialMix: [{ rawMaterialId: 1, percentage: 49 }, { rawMaterialId: 2, percentage: 49 }]
                })).rejects.toMatchObject({ key: "errors.mix_percentage_must_total_100" })
            })

            it("un ingrediente mandado dentro de la mezcla del cliente no se costea como ingrediente (no está en el pool -> 422)", async () => {
                stubIngredientVariant({ isCustomizable: true, productRawMaterials: POOL })

                await expect(quoteService.calculateQuote({
                    ...input,
                    rawMaterialMix: [{ rawMaterialId: 1, percentage: 98 }, { rawMaterialId: SAL.ingredientId, percentage: 2 }]
                })).rejects.toMatchObject({ key: "errors.raw_material_not_in_pool" })
            })
        })

        it("el cliente no puede alterar los ingredientes: una clave extra en el payload se ignora (el schema la descarta y el motor no la lee)", async () => {
            stubIngredientVariant()
            const rawPayload = { ...input, ingredients: [{ ingredientId: 50, grams: 0 }], ingredientMix: [{ ingredientId: 50, percentage: 0 }] }

            const parsed = calculateQuoteSchema.parse(rawPayload)
            expect(parsed).not.toHaveProperty("ingredients")
            expect(parsed).not.toHaveProperty("ingredientMix")

            const result = await quoteService.calculateQuote(rawPayload as unknown as CalculateQuoteInput)
            expect(result.ingredientCost).toBe(7.9366)
        })

        it("usa el nombre traducido del ingrediente según el idioma", async () => {
            stubIngredientVariant()

            const result = await quoteService.calculateQuote(input, "en")

            expect(result.breakdown.ingredients[0].displayName).toBe("Salt")
        })

        it("saveQuote persiste ingredientCost como columna y congela las líneas en breakdown.ingredients", async () => {
            stubIngredientVariant()
            mockQuoteCreate.mockResolvedValueOnce({ id: 77, get: () => new Date("2026-09-27T00:00:00Z") })

            await quoteService.saveQuote(42, input)

            const persisted = mockQuoteCreate.mock.calls[mockQuoteCreate.mock.calls.length - 1][0]
            expect(persisted.ingredientCost).toBe(7.9366)
            expect(persisted.breakdown.ingredients).toEqual([expect.objectContaining({ ingredientId: 50, grams: 40, referenceNetWeightGrams: 2000, lineTotal: 7.9366 })])
        })
    })

    describe("etiqueta compuesta de la variante (variantLabel, 2026-09-13)", () => {
        // Mismo formato que el selector de SKU del frontend: "{{bagsPerBox}} und × {{presentacion}} ·
        // {{boxesPerPallet}} cajas/palet". No incluye el nombre del producto (va en productDisplayName).
        function stubVariantForLabel(overrides: { sizePresentation?: { displayLabel: string } | undefined } = {}): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 385,
                bagsPerBox: 6,
                parentProduct: { isCustomizable: false, displayName: "Jugo Piña Zanahoria Vidassa", productRawMaterials: [] },
                sizePresentation: overrides.sizePresentation,
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Envase", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
        }

        it("compone 'N und × presentación · N cajas/palet' en español", async () => {
            stubVariantForLabel({ sizePresentation: { displayLabel: "976 ml" } })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.variantLabel).toBe("6 und × 976 ml · 385 cajas/palet")
        })

        it("en inglés compone con 'units'/'boxes/pallet' en vez de 'und'/'cajas/palet'", async () => {
            stubVariantForLabel({ sizePresentation: { displayLabel: "976 ml" } })

            const result = await quoteService.calculateQuote(baseInput, "en")

            expect(result.variantLabel).toBe("6 units × 976 ml · 385 boxes/pallet")
        })

        it("omite el segmento de presentación si la variante no tiene sizePresentation, sin mostrar undefined/null", async () => {
            stubVariantForLabel({ sizePresentation: undefined })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.variantLabel).toBe("6 und · 385 cajas/palet")
            expect(result.variantLabel).not.toMatch(/undefined|null/)
        })

        it("no repite el nombre del producto dentro de variantLabel (productDisplayName va aparte)", async () => {
            stubVariantForLabel({ sizePresentation: { displayLabel: "976 ml" } })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.productDisplayName).toBe("Jugo Piña Zanahoria Vidassa")
            expect(result.variantLabel).not.toContain("Jugo Piña Zanahoria Vidassa")
        })
    })
})

describe("quoteService.saveQuote", () => {
    beforeEach(() => {
        stubDestination()
        mockProcessingCostFindAll.mockResolvedValue([]) // ver comentario junto al mock del modelo, arriba del archivo
    })

    it("nunca confía en el desglose del cliente: siempre persiste lo que devuelve calculateQuote, no el input recibido", async () => {
        mockVariantFindOne.mockResolvedValue({
            id: 10,
            boxesPerPallet: 20,
            bagsPerBox: 1,
            parentProduct: {
                isCustomizable: false,
                displayName: "Piña en Trozos",
                productRawMaterials: [
                    { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1 } } }
                ]
            },
            sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 0.5 },
            unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa plástica", unitCost: 1 } }],
            palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
        })
        mockQuoteCreate.mockResolvedValue({ id: 555, get: () => new Date("2026-08-10T00:00:00Z") })

        // Input "malicioso": intenta mandar un totalCost inventado por fuera del schema real.
        // calculateQuoteSchema no tiene ese campo, así que TypeScript ya lo rechazaría en
        // producción -- lo forzamos aquí con `as` para simular un cliente que igual lo intenta
        // a nivel de HTTP crudo (bypaseando el tipo).
        const tamperedInput = {
            productVariantId: 10,
            destinationId: 900,
            requestedPallets: 1,
            totalCost: 999999,
        } as CalculateQuoteInput

        const saved = await quoteService.saveQuote(42, tamperedInput)

        // rawMaterialCost(200) + unitPackagingCost(20) + palletMaterialCost(0, material de $0) + transportCost(50)
        expect(saved.totalCost).toBe(270) // recalculado server-side, no 999999
        expect(mockQuoteCreate).toHaveBeenCalledWith(
            expect.objectContaining({ salespersonId: 42, totalCost: 270, processingCostTotal: 0 })
        )
    })

    // Guardar una cotización no crea, busca ni vincula un prospecto (Lead).
    describe("sin vínculo con Lead (prospecto)", () => {
        function stubMinimalVariant(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, displayName: "Piña en Trozos", productRawMaterials: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
        }

        it("guarda la cotización con solo variante + palets (sin datos de prospecto)", async () => {
            stubMinimalVariant()
            mockQuoteCreate.mockResolvedValue({ id: 600, get: () => new Date("2026-09-21T00:00:00Z") })

            const saved = await quoteService.saveQuote(42, { productVariantId: 10, requestedPallets: 1 })

            expect(saved.id).toBe(600)
            expect(mockQuoteCreate).toHaveBeenCalledTimes(1)
        })

        it("no persiste ni devuelve ningún leadId, aunque un payload crudo intente mandarlo", async () => {
            stubMinimalVariant()
            mockQuoteCreate.mockResolvedValue({ id: 601, get: () => new Date("2026-09-21T00:00:00Z") })

            const tamperedInput = { productVariantId: 10, requestedPallets: 1, leadId: 999999, leadContact: { email: "x@y.com" } } as unknown as CalculateQuoteInput
            const saved = await quoteService.saveQuote(42, tamperedInput)

            expect(mockQuoteCreate.mock.calls[0][0]).not.toHaveProperty("leadId")
            expect(saved).not.toHaveProperty("leadId")
        })
    })

    function stubOnePoundVariant(): void {
        mockVariantFindOne.mockResolvedValue({
            id: 10,
            boxesPerPallet: 1,
            bagsPerBox: 1,
            parentProduct: {
                isCustomizable: false,
                displayName: "Piña en Trozos",
                // percentage:100/baseFactor:1 arbitrarios -- estos tests solo aseguran
                // processingCostTotal, netWeightGrams (1 lb) es lo único load-bearing acá.
                productRawMaterials: [
                    { rawMaterialId: 1, percentage: 100, usedRawMaterial: { displayName: "Piña", costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1 } } }
                ]
            },
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- catálogo estático hardcodeado, "pound" siempre existe (ver unitCatalog.ts)
            sizePresentation: { displayLabel: "Bolsa", netWeightGrams: getUnitCatalogEntry("pound")!.baseFactor },
            unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
            palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
        })
    }

    it("ignora cualquier processingCostTotal/breakdown.processingCosts que el front intente mandar -- siempre recalcula del catálogo real", async () => {
        stubOnePoundVariant()
        mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 1, calculationType: "per_weight", translations: [] }])
        mockQuoteCreate.mockResolvedValue({ id: 777, get: () => new Date("2026-08-10T00:00:00Z") })

        // Mismo criterio que el test de arriba (totalCost inventado): calculateQuoteSchema no
        // tiene estos campos, TypeScript los rechazaría en producción -- se fuerza con `as` para
        // simular un payload HTTP crudo que intenta bypasear el tipo.
        const tamperedInput = {
            productVariantId: 10,
            destinationId: 900,
            requestedPallets: 1,
            processingCostTotal: 999999,
            breakdown: {
                processingCosts: [
                    { processingCostId: 999, displayName: "Falso", value: 999, totalWeightPounds: 1, lineTotal: 999999 }
                ]
            },
        } as CalculateQuoteInput

        const saved = await quoteService.saveQuote(42, tamperedInput)

        // totalUnits = 1 palet * 1 unidad/palet = 1; 1 unidad de exactamente 1 libra * USD 1/lb = USD 1.
        expect(saved.processingCostTotal).toBe(1)
        expect(saved.breakdown.processingCosts).toEqual([
            expect.objectContaining({ processingCostId: 1, lineTotal: 1 })
        ])
        expect(mockQuoteCreate).toHaveBeenCalledWith(expect.objectContaining({ processingCostTotal: 1 }))
    })

    it("una cotización ya guardada NO cambia retroactivamente cuando el catálogo de costos adicionales se edita/desactiva después (el snapshot queda congelado)", async () => {
        stubOnePoundVariant()
        mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 3, calculationType: "per_weight", translations: [] }])
        mockQuoteCreate.mockResolvedValueOnce({ id: 1, get: () => new Date("2026-01-01T00:00:00Z") })

        const quote1 = await quoteService.saveQuote(42, { productVariantId: 10, destinationId: 900, requestedPallets: 1 })
        expect(quote1.processingCostTotal).toBe(3) // 1 libra * USD 3/lb

        // El admin ahora desactiva el costo (simula "el catálogo cambió después") y se cotiza
        // un pedido NUEVO -- esto no debe tocar en absoluto lo que ya se guardó en quote1.
        mockProcessingCostFindAll.mockResolvedValue([])
        mockQuoteCreate.mockResolvedValueOnce({ id: 2, get: () => new Date("2026-01-02T00:00:00Z") })

        const quote2 = await quoteService.saveQuote(42, { productVariantId: 10, destinationId: 900, requestedPallets: 1 })
        expect(quote2.processingCostTotal).toBe(0)

    
        expect(mockQuoteCreate.mock.calls[0][0]).toMatchObject({ processingCostTotal: 3 })
        expect(mockQuoteCreate.mock.calls[1][0]).toMatchObject({ processingCostTotal: 0 })
        // Y el resultado ya devuelto de la primera llamada (lo que viajó a la respuesta HTTP)
        // tampoco se muta después por la segunda llamada.
        expect(quote1.processingCostTotal).toBe(3)
        expect(quote1.breakdown.processingCosts).toEqual([expect.objectContaining({ processingCostId: 1, lineTotal: 3 })])
    })

    describe("borrador (draftKey) -- la cotización finalizada no cambia en nada", () => {
        const DRAFT_KEY = "3f1c2b8e-9d4a-4c6b-8e2f-1a2b3c4d5e6f"
        const mockMarkConverted = quoteDraftService.markConverted as jest.Mock

        beforeEach(() => {
            mockMarkConverted.mockReset()
            stubOnePoundVariant()
        })

        it("con draftKey, marca el borrador convertido DESPUÉS del Quote.create, con el id real de la cotización", async () => {
            mockQuoteCreate.mockResolvedValue({ id: 812, get: () => new Date("2026-09-28T00:00:00Z") })
            mockMarkConverted.mockResolvedValue(undefined)

            await quoteService.saveQuote(42, { productVariantId: 10, requestedPallets: 1, draftKey: DRAFT_KEY })

            expect(mockMarkConverted).toHaveBeenCalledWith(DRAFT_KEY, 42, 812)
            expect(mockQuoteCreate.mock.invocationCallOrder[0]).toBeLessThan(mockMarkConverted.mock.invocationCallOrder[0])
        })

        it("si markConverted falla, la cotización real igual se guarda y se devuelve", async () => {
            mockQuoteCreate.mockResolvedValue({ id: 813, get: () => new Date("2026-09-28T00:00:00Z") })
            mockMarkConverted.mockRejectedValue(new Error("db down"))
            const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

            const saved = await quoteService.saveQuote(42, { productVariantId: 10, requestedPallets: 1, draftKey: DRAFT_KEY })

            expect(saved.id).toBe(813)
            expect(mockQuoteCreate).toHaveBeenCalledTimes(1)
            consoleErrorSpy.mockRestore()
        })

        it("sin draftKey no toca borradores", async () => {
            mockQuoteCreate.mockResolvedValue({ id: 814, get: () => new Date("2026-09-28T00:00:00Z") })

            await quoteService.saveQuote(42, { productVariantId: 10, requestedPallets: 1 })

            expect(mockMarkConverted).not.toHaveBeenCalled()
        })

        it("el payload de Quote.create y la respuesta son idénticos con o sin draftKey", async () => {
            mockQuoteCreate.mockResolvedValue({ id: 815, get: () => new Date("2026-09-28T00:00:00Z") })

            const withoutKey = await quoteService.saveQuote(42, { productVariantId: 10, requestedPallets: 1 })
            const withKey = await quoteService.saveQuote(42, { productVariantId: 10, requestedPallets: 1, draftKey: DRAFT_KEY })

            expect(mockQuoteCreate.mock.calls[1][0]).toEqual(mockQuoteCreate.mock.calls[0][0])
            expect(mockQuoteCreate.mock.calls[1][0]).not.toHaveProperty("draftKey")
            expect(withKey).toEqual(withoutKey)
            expect(withKey).not.toHaveProperty("draftKey")
        })
    })
})

describe("quoteService.listQuotableProducts", () => {
    it.each(["https://bucket/subcategories/berries.png", null, undefined])("returns the optional subcategory image %s in the same catalog", async (imageUrl) => {
        mockProductFindAll.mockResolvedValue([{ toJSON: () => ({
            id: 1, subCategoryId: 12, displayName: "Fresa", isCustomizable: false,
            parentSubCategory: { id: 12, displayName: "Bayas", imageUrl },
        }) }])
        const [product] = await quoteService.listQuotableProducts()
        expect(product.subCategoryImageUrl).toBe(imageUrl ?? null)
        expect(mockProductFindAll).toHaveBeenCalledTimes(1)
    })
    it("includes subcategory translations in the existing catalog query", async () => {
        mockProductFindAll.mockResolvedValue([])
        await quoteService.listQuotableProducts("en")
        expect(mockProductFindAll).toHaveBeenCalledWith(expect.objectContaining({
            include: expect.arrayContaining([expect.objectContaining({
                as: "parentSubCategory", include: expect.arrayContaining([expect.objectContaining({ as: "translations" })]),
            })]),
        }))
    })

    it.each(["en", "es"] as const)("returns actual subcategory identities and translated names in %s", async (language) => {
        mockProductFindAll.mockResolvedValue([{
            toJSON: () => ({
                id: 1, subCategoryId: 12, displayName: "Fresa", isCustomizable: false,
                parentSubCategory: {
                    id: 12, displayName: "Bayas", translations: [{ language: "en", displayName: "Berries" }],
                    parentCategory: { id: 3, displayName: "Congelados", translations: [{ language: "en", displayName: "Frozen" }] },
                },
            }),
        }])
        const [product] = await quoteService.listQuotableProducts(language)
        expect(product).toMatchObject({
            categoryId: 3, categoryName: language === "en" ? "Frozen" : "Congelados",
            subCategoryId: 12, subCategoryName: language === "en" ? "Berries" : "Bayas",
        })
    })

    beforeEach(() => {
        mockProductFindAll.mockReset().mockResolvedValue([])
    })

    // presentationId es NOT NULL en ProductVariant, pero el filtro de la query es defensa en
    // profundidad; sin BD real, se verifica que la query arme el `where` correcto.
    it("filtra las variantes incluidas por presentationId NOT NULL, junto con boxesPerPallet/bagsPerBox", async () => {
        await quoteService.listQuotableProducts()

        expect(mockProductFindAll).toHaveBeenCalledTimes(1)
        const call = mockProductFindAll.mock.calls[0][0] as { include: { as?: string; where?: Record<string, unknown> }[] }
        const variantInclude = call.include.find(inc => inc.as === "productVariants")

        expect(variantInclude?.where).toMatchObject({
            presentationId: { [Op.not]: null },
            boxesPerPallet: { [Op.not]: null },
            bagsPerBox: { [Op.not]: null },
        })
    })

    it("devuelve una lista vacía cuando no hay productos activos con variantes quotable (caso base)", async () => {
        const result = await quoteService.listQuotableProducts()

        expect(result).toEqual([])
    })

    describe("fixedRecipe / rawMaterialPool -- el cliente debe VER una receta fija, pero solo puede EDITAR un mix personalizable", () => {
        function stubPlainProduct(overrides: Record<string, unknown>): void {
            const plain = {
                id: 1,
                displayName: "Producto",
                isOrganic: false,
                imageUrl: null,
                parentSubCategory: null,
                productVariants: [],
                productRawMaterials: [],
                translations: [],
                ...overrides
            }
            mockProductFindAll.mockResolvedValue([{ ...plain, toJSON: () => plain }])
        }

        it("expone fixedRecipe (nombre + %) para un producto de receta fija, e rawMaterialPool vacío", async () => {
            stubPlainProduct({
                isCustomizable: false,
                productRawMaterials: [
                    { rawMaterialId: 1, percentage: 50, usedRawMaterial: { displayName: "Banano", translations: [] } },
                    { rawMaterialId: 2, percentage: 50, usedRawMaterial: { displayName: "Fresa", translations: [] } }
                ]
            })

            const [result] = await quoteService.listQuotableProducts()

            expect(result.fixedRecipe).toEqual([
                { rawMaterialId: 1, displayName: "Banano", percentage: 50 },
                { rawMaterialId: 2, displayName: "Fresa", percentage: 50 }
            ])
            expect(result.rawMaterialPool).toEqual([])
        })

        it("expone rawMaterialPool (rango editable) para un producto personalizable, y fixedRecipe vacío", async () => {
            stubPlainProduct({
                isCustomizable: true,
                productRawMaterials: [
                    { rawMaterialId: 1, minPercentage: 20, maxPercentage: 80, usedRawMaterial: { displayName: "Piña", isOrganic: false, translations: [] } }
                ]
            })

            const [result] = await quoteService.listQuotableProducts()

            expect(result.rawMaterialPool).toEqual([
                { rawMaterialId: 1, displayName: "Piña", isOrganic: false, minPercentage: 20, maxPercentage: 80 }
            ])
            expect(result.fixedRecipe).toEqual([])
        })
    })

    describe("grupos de opciones (2026-09-24) -- menú agrupado y packagingLabel", () => {
        function stubProductWithVariant(variantOverrides: Record<string, unknown>): void {
            const plain = {
                id: 1,
                displayName: "Producto",
                isOrganic: false,
                isCustomizable: false,
                imageUrl: null,
                parentSubCategory: null,
                productRawMaterials: [],
                translations: [],
                productVariants: [
                    {
                        id: 10,
                        boxesPerPallet: 20,
                        bagsPerBox: 1,
                        sizePresentation: { displayLabel: "Bolsa" },
                        unitMaterials: [],
                        intermediateMaterials: [],
                        palletMaterials: [],
                        ...variantOverrides
                    }
                ]
            }
            mockProductFindAll.mockResolvedValue([{ ...plain, toJSON: () => plain }])
        }

        it("agrupa las filas con optionGroup por grupo (una entrada por grupo, opciones ordenadas por id) -- las fijas nunca son una 'opción'", async () => {
            stubProductWithVariant({
                palletMaterials: [
                    { id: 600, packagingId: 6, optionGroup: null, isDefault: false, usedPalletMaterial: { displayName: "Film", unitCost: 1 } },
                    { id: 603, packagingId: 24, optionGroup: "Esquinero", isDefault: true, usedPalletMaterial: { displayName: "Esquinero de cartón", unitCost: "0.50" } },
                    { id: 602, packagingId: 23, optionGroup: "caja", isDefault: false, usedPalletMaterial: { displayName: "Caja de estante", unitCost: 9 } },
                    { id: 601, packagingId: 22, optionGroup: "Caja", isDefault: true, usedPalletMaterial: { displayName: "Caja de envío", unitCost: 4 } }
                ]
            })

            const [result] = await quoteService.listQuotableProducts()

            expect(result.variants[0].palletMaterialOptionGroups).toEqual([
                {
                    group: "Caja",
                    options: [
                        { id: 601, packagingId: 22, displayName: "Caja de envío", unitCost: 4, isDefault: true },
                        { id: 602, packagingId: 23, displayName: "Caja de estante", unitCost: 9, isDefault: false }
                    ]
                },
                {
                    group: "Esquinero",
                    options: [{ id: 603, packagingId: 24, displayName: "Esquinero de cartón", unitCost: 0.5, isDefault: true }]
                }
            ])
        })

        it("packagingLabel muestra lo que se costea por defecto (fijas + el default de cada grupo), no todas las alternativas", async () => {
            stubProductWithVariant({
                unitMaterials: [
                    { id: 500, packagingId: 5, optionGroup: null, isDefault: false, usedUnitMaterial: { displayName: "Etiqueta", unitCost: 1 } },
                    { id: 501, packagingId: 20, optionGroup: "Bolsa", isDefault: true, usedUnitMaterial: { displayName: "Bolsa estándar", unitCost: 2 } },
                    { id: 502, packagingId: 21, optionGroup: "Bolsa", isDefault: false, usedUnitMaterial: { displayName: "Bolsa con logo", unitCost: 5 } },
                    { id: 503, packagingId: 22, optionGroup: "Tapa", isDefault: true, usedUnitMaterial: { displayName: "Tapa simple", unitCost: 3 } }
                ]
            })

            const [result] = await quoteService.listQuotableProducts()

            expect(result.variants[0].packagingLabel).toBe("Etiqueta + Bolsa estándar + Tapa simple")
            expect(result.variants[0].unitMaterialOptionGroups.map(group => group.group)).toEqual(["Bolsa", "Tapa"])
        })

        it("un nivel sin filas agrupadas expone una lista de grupos vacía", async () => {
            stubProductWithVariant({
                unitMaterials: [{ id: 500, packagingId: 5, optionGroup: null, isDefault: false, usedUnitMaterial: { displayName: "Empaque único", unitCost: 1 } }]
            })

            const [result] = await quoteService.listQuotableProducts()

            expect(result.variants[0].unitMaterialOptionGroups).toEqual([])
            expect(result.variants[0].intermediateMaterialOptionGroups).toEqual([])
            expect(result.variants[0].palletMaterialOptionGroups).toEqual([])
            expect(result.variants[0].packagingLabel).toBe("Empaque único")
        })
    })
})

describe("quoteService.listAllQuotes date range", () => {
    const findAll = Quote.findAll as unknown as jest.Mock
    beforeEach(() => findAll.mockReset().mockResolvedValue([]))
    it("filters inclusive Guatemala days without changing the ordering", async () => {
        await quoteService.listAllQuotes({ startDate: "2026-10-01", endDate: "2026-10-07" })
        const query = findAll.mock.calls[0][0]
        expect(query.where.createdAt[Op.gte].toISOString()).toBe("2026-10-01T06:00:00.000Z")
        expect(query.where.createdAt[Op.lte].toISOString()).toBe("2026-10-08T05:59:59.999Z")
        expect(query.order).toEqual([["createdAt", "DESC"]])
    })
    it("All time has no date restriction, and open ranges retain their boundary", async () => {
        await quoteService.listAllQuotes()
        expect(findAll.mock.calls[0][0].where).toBeUndefined()
        await quoteService.listAllQuotes({ endDate: "2026-10-07" })
        expect(findAll.mock.calls[1][0].where.createdAt[Op.gte]).toBeUndefined()
        expect(findAll.mock.calls[1][0].where.createdAt[Op.lte].toISOString()).toBe("2026-10-08T05:59:59.999Z")
    })
})
