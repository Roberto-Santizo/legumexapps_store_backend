import "reflect-metadata"

// Mocks manuales de los modelos: quote.service.ts solo llama a ProductVariant.findOne,
// Destination.findOne y Quote.create -- no hace falta una base de datos real ni los
// decoradores de sequelize-typescript para probar la lógica de negocio de calculateQuote.
// Cada mock devuelve un objeto plano con exactamente la forma que calculateQuote lee
// (ver quote.service.ts), no una instancia real de Sequelize.
jest.mock("../../product/models/ProductVariant.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
jest.mock("../../destination/models/Destination.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
jest.mock("../models/Quote.model", () => ({
    __esModule: true,
    default: { create: jest.fn() }
}))
// saveQuote ahora también resuelve un Lead (crear-o-reusar por email, ver
// leadService.findOrCreateLeadForQuote) -- se mockea el modelo, no el service, para ejercitar la
// regla real de negocio (findOne primero, create solo si no existe) tal como corre en producción.
jest.mock("../../lead/models/Lead.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn() }
}))
// Catálogo de costos adicionales -- por defecto SIN filas activas (ver beforeEach) para que
// todos los tests existentes (escritos antes de esta feature) sigan calculando exactamente
// igual que antes; los tests dedicados a "costos adicionales" más abajo pisan este mock.
jest.mock("../../processingCost/models/ProcessingCost.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn() }
}))

import ProductVariant from "../../product/models/ProductVariant.model"
import Destination from "../../destination/models/Destination.model"
import Quote from "../models/Quote.model"
import Lead from "../../lead/models/Lead.model"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import { quoteService } from "./quote.service"
import { NotFoundError } from "../../../shared/errors/AppError"
import { CalculateQuoteInput, SaveQuoteInput } from "../schemas/quote.schema"
// Se importa el catálogo REAL (no mockeado -- es un módulo de constantes puro, sin Sequelize) para
// derivar el factor gramos->libras de la misma fuente que usa quote.service.ts, en vez de
// hardcodear "453.592" una tercera vez en este archivo. Si algún día quote.service.ts dejara de
// leer este catálogo y usara una constante propia desalineada, estos tests lo detectan solos.
import { getUnitCatalogEntry } from "../../unit/constants/unitCatalog"

const mockVariantFindOne = ProductVariant.findOne as unknown as jest.Mock
const mockDestinationFindOne = Destination.findOne as unknown as jest.Mock
const mockQuoteCreate = Quote.create as unknown as jest.Mock
const mockProcessingCostFindAll = ProcessingCost.findAll as unknown as jest.Mock
const mockLeadFindOne = Lead.findOne as unknown as jest.Mock
const mockLeadCreate = Lead.create as unknown as jest.Mock

// Costo de destino usado en todos los casos salvo que un test lo pise explícitamente.
const DESTINATION = { id: 900, displayName: "Puerto Cortés", baseCost: 50 }

function stubDestination(overrides: Partial<typeof DESTINATION> = {}): void {
    mockDestinationFindOne.mockResolvedValue({ ...DESTINATION, ...overrides })
}

// Datos de contacto usados en todos los tests de saveQuote salvo que uno los pise explícitamente
// -- por defecto, ningún Lead existente con ese email (findOrCreateLeadForQuote crea uno nuevo).
const LEAD_CONTACT = { fullName: "Juan Pérez", companyName: "Comercial Pérez", email: "juan@example.com", notes: undefined }

function stubLead(overrides: { existing?: { id: number } } = {}): void {
    mockLeadFindOne.mockResolvedValue(overrides.existing ?? null)
    mockLeadCreate.mockResolvedValue({ id: overrides.existing?.id ?? 500, ...LEAD_CONTACT })
}

describe("quoteService.calculateQuote", () => {
    beforeEach(() => {
        stubDestination()
        mockProcessingCostFindAll.mockResolvedValue([]) // catálogo vacío por defecto, ver comentario del mock arriba
        stubLead()
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
                parentProduct: { isCustomizable: false, productIngredients: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
            mockDestinationFindOne.mockResolvedValue(null)

            await expect(quoteService.calculateQuote(baseInput)).rejects.toBeInstanceOf(NotFoundError)
        })

        it("rechaza si la variante no tiene boxesPerPallet configurado (bug histórico: cotizar sin palet configurado)", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, boxesPerPallet: null, bagsPerBox: 5, parentProduct: { isCustomizable: false, productIngredients: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })

        it("rechaza si la variante no tiene bagsPerBox configurado (mismo guard, el otro factor de la derivación)", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, boxesPerPallet: 4, bagsPerBox: null, parentProduct: { isCustomizable: false, productIngredients: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })

        it("rechaza boxesPerPallet en 0 igual que null", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, boxesPerPallet: 0, bagsPerBox: 5, parentProduct: { isCustomizable: false, productIngredients: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })

        it("rechaza bagsPerBox en 0 igual que null", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, boxesPerPallet: 4, bagsPerBox: 0, parentProduct: { isCustomizable: false, productIngredients: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })

        it("bagsPerPallet se deriva como boxesPerPallet × bagsPerBox (no como un input directo) -- totalUnits lo prueba end-to-end", async () => {
            // 4 cajas/palet × 5 bolsas/caja = 20 bolsas/palet -- el mismo total que daba el viejo
            // unitsPerPallet=20 manual, ahora nunca se escribe directo, siempre se deriva.
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 4,
                bagsPerBox: 5,
                parentProduct: { isCustomizable: false, productIngredients: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote({ ...baseInput, requestedPallets: 3 })

            // totalUnits = requestedPallets(3) * boxesPerPallet(4) * bagsPerBox(5) = 60
            expect(result.totalUnits).toBe(60)
        })
    })

    describe("transporte apagado (sin destinationId, 2026-09-10 -- el cliente ya no elige destino)", () => {
        function stubMinimalVariant(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Piña en Trozos",
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 2000 },
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

            // rawMaterialCost = costPerUnit(20) * quantityValue(0.5) * totalUnits(20) = 200
            // unitPackagingCost = unitCost(1) * totalUnits(20) = 20
            // total = 220, SIN componente de transporte (antes habría sido 220 + 50 de baseCost)
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

            const saved = await quoteService.saveQuote(42, { ...inputWithoutDestination, leadContact: LEAD_CONTACT })

            expect(saved.destinationId).toBeNull()
            expect(mockQuoteCreate.mock.calls[0][0]).toMatchObject({ destinationId: null, transportCost: 0 })
        })
    })

    describe("receta fija (producto no personalizable)", () => {
        function stubFixedRecipeVariant(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Piña en Trozos",
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
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

        it("calcula el total correcto sumando materia prima + empaque + materiales de palet + transporte", async () => {
            stubFixedRecipeVariant()

            const result = await quoteService.calculateQuote(baseInput)

            // totalUnits = 1 palet * 20 unidades/palet = 20
            expect(result.totalUnits).toBe(20)
            // rawMaterialCost = costPerUnit(20) * quantityValue(0.5) * totalUnits(20)
            expect(result.rawMaterialCost).toBe(200)
            // unitPackagingCost = unitCost(1) * totalUnits(20)
            expect(result.unitPackagingCost).toBe(20)
            // palletMaterialCost = (1*10*1) + (1*4*1)
            expect(result.palletMaterialCost).toBe(14)
            expect(result.transportCost).toBe(50)
            expect(result.totalCost).toBe(284)
        })

        it("conserva hasta 4 decimales de precisión en vez de redondear a centavos (2026-08-24, a pedido explícito del usuario)", async () => {
            // costPerUnit con 4 decimales significativos * quantityValue exacto -> el lineTotal
            // real tiene 4 decimales (0.1234). Si el motor todavía redondeara a 2 decimales
            // (comportamiento viejo), este valor se habría truncado a 0.12, perdiendo 0.0034 por
            // unidad -- insignificante en una unidad, pero real y acumulable a escala de palet.
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 1, usedIngredient: { displayName: "Trazas", costPerUnit: 0.1234 } }
                    ]
                },
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
                parentProduct: { isCustomizable: false, productIngredients: [] },
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
                parentProduct: { isCustomizable: false, productIngredients: [] },
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
                parentProduct: { isCustomizable: false, productIngredients: [] },
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
                parentProduct: { isCustomizable: false, productIngredients: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja gratis", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.palletMaterialCost).toBe(0)
            expect(result.breakdown.palletMaterials).toHaveLength(1)
        })

        it("intermediatePackagingCost queda en 0 y el breakdown en null cuando la variante no tiene empaque intermedio (caso normal, la mayoría de variantes)", async () => {
            stubFixedRecipeVariant()

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.intermediatePackagingCost).toBe(0)
            expect(result.breakdown.intermediatePackaging).toBeNull()
        })

        it("no revienta con un ingrediente gratis (costPerUnit = 0) -- la línea da 0, no NaN/undefined", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 5, usedIngredient: { displayName: "Agua", costPerUnit: 0 } }
                    ]
                },
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
                parentProduct: { isCustomizable: false, productIngredients: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [
                    { packagingId: 6, quantityValue: 0, usedPalletMaterial: { displayName: "Caja corrugada", unitCost: 5 } }
                ]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.palletMaterialCost).toBe(0)
            expect(result.breakdown.palletMaterials[0].lineTotal).toBe(0)
        })

        it("reconcilia exacto (sin arrastre de precisión) con 3 ingredientes de receta fija en costos que drift en floats nativos", async () => {
            // Mismo espíritu que el test de "tercios" del mix personalizable, pero para
            // buildFixedRecipeRawMaterials -- es una función separada con la misma clase de
            // riesgo de precisión, no puede asumirse cubierta solo porque la rama customizable
            // ya se probó.
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 1, usedIngredient: { displayName: "A", costPerUnit: 0.1 } },
                        { ingredientId: 2, quantityValue: 1, usedIngredient: { displayName: "B", costPerUnit: 0.2 } },
                        { ingredientId: 3, quantityValue: 1, usedIngredient: { displayName: "C", costPerUnit: 0.0001 } }
                    ]
                },
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
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.3333, usedIngredient: { displayName: "A", costPerUnit: 7.77 } }
                    ]
                },
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
                parentProduct: { isCustomizable: false, productIngredients: [], additionalCostPerUnit },
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
                parentProduct: { isCustomizable: false, productIngredients: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.adjustmentCost).toBe(0)
            expect(result.breakdown.adjustment).toBeNull()
        })
    })

    describe("costos adicionales por peso (catálogo ProcessingCost, energía/mano de obra/etc.)", () => {
        function stubVariantForProcessingCosts(netWeightGrams: number | null): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Piña en Trozos",
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
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
            // 40000g / 453.592 g/lb = 88.18490245... lb. Costo Q0.15/lb.
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

        it("no exige peso neto si el catálogo está vacío (no rompe productos de receta fija existentes sin este dato)", async () => {
            stubVariantForProcessingCosts(null)
            mockProcessingCostFindAll.mockResolvedValue([])

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.processingCostTotal).toBe(0)
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
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
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
            // @ts-expect-error -- simula deliberadamente la forma cruda que devuelve Sequelize (string) en vez del tipo declarado (number)
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
                    productIngredients: [{ ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }]
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
                        productIngredients: [{ ingredientId: 1, quantityValue: 0.1, usedIngredient: { displayName: "X", costPerUnit: 1 } }]
                    },
                    sizePresentation: { displayLabel: "Presentación", netWeightGrams },
                    unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                    palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
                })
            }

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- catálogo estático hardcodeado, "pound" siempre existe (ver unitCatalog.ts)
            const GRAMS_PER_POUND = getUnitCatalogEntry("pound")!.baseFactor

            it("1 unidad de exactamente 1 libra de peso neto, costo Q2/lb -> Q2 exactos (número limpio, verificable a mano)", async () => {
                stubVariantWithWeight(GRAMS_PER_POUND, 1) // 1 palet * 1 unidad/palet = 1 unidad de 1lb
                mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 2, calculationType: "per_weight", translations: [] }])

                const result = await quoteService.calculateQuote(baseInput)

                expect(result.processingCostTotal).toBe(2)
                expect(result.breakdown.processingCosts[0].totalWeightPounds).toBe(1)
            })

            it("1 unidad de exactamente 2 libras de peso neto, costo Q1/lb -> Q2 exactos", async () => {
                stubVariantWithWeight(GRAMS_PER_POUND * 2, 1)
                mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 1, calculationType: "per_weight", translations: [] }])

                const result = await quoteService.calculateQuote(baseInput)

                expect(result.processingCostTotal).toBe(2)
                expect(result.breakdown.processingCosts[0].totalWeightPounds).toBe(2)
            })

            it("10 unidades de exactamente 1 libra cada una, costo Q1/lb -> Q10 exactos (escala con totalUnits)", async () => {
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
                    productIngredients: [{ ingredientId: 1, quantityValue: 0.1, usedIngredient: { displayName: "X", costPerUnit: 1 } }]
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

            // rawMaterialCost(200) + unitPackagingCost(20) + transportCost(50), con un material
            // de palet de costo $0 en este fixture (solo para satisfacer la guarda de "al menos
            // un material de palet", ver pallet_materials_not_configured) -- el punto es que el
            // total NO se mueve ni un centavo por la sola presencia de esta feature cuando el
            // catálogo de costos adicionales está vacío.
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
                    productIngredients: [{ ingredientId: 1, quantityValue: 1, usedIngredient: { displayName: "X", costPerUnit: 2 } }],
                    additionalCostPerUnit: 0.5
                },
                sizePresentation: { displayLabel: "Bolsa", netWeightGrams: GRAMS_PER_POUND }, // 1 lb por unidad
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsa", unitCost: 1 } }],
                usedIntermediatePackaging: { id: 6, displayName: "Bolsa grande", unitCost: 3 },
                palletMaterials: [{ packagingId: 7, quantityValue: 2, usedPalletMaterial: { displayName: "Caja", unitCost: 4 } }]
            })
            mockProcessingCostFindAll.mockResolvedValue([{ id: 1, displayName: "Energía", value: 1, calculationType: "per_weight", translations: [] }])

            const result = await quoteService.calculateQuote(baseInput) // requestedPallets=1 -> totalUnits = 10

            // rawMaterialCost = costPerUnit(2) * quantityValue(1) * totalUnits(10) = 20
            expect(result.rawMaterialCost).toBe(20)
            // unitPackagingCost = unitCost(1) * totalUnits(10) = 10
            expect(result.unitPackagingCost).toBe(10)
            // intermediatePackagingCost = ceil(10/5)=2 paquetes * unitCost(3) = 6
            expect(result.intermediatePackagingCost).toBe(6)
            // processingCostTotal = 10 unidades * 1lb c/u = 10lb * Q1/lb = 10
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
        // ProcessingCost.findAll se llama dos veces (una para "per_weight", otra para
        // "percentage") -- un jest.fn() compartido con mockResolvedValue() respondería lo mismo a
        // ambas llamadas, así que acá se inspecciona el `where.calculationType` real para
        // devolver la lista correcta a cada una (mismo patrón ya usado en otras suites del repo
        // para mocks con más de una forma de "where" posible).
        function stubProcessingCosts(rows: { perWeight?: unknown[]; percentage?: unknown[] } = {}): void {
            const perWeightRows = rows.perWeight ?? []
            const percentageRows = rows.percentage ?? []
            mockProcessingCostFindAll.mockImplementation(({ where }: { where: { calculationType: string } }) =>
                Promise.resolve(where.calculationType === "percentage" ? percentageRows : perWeightRows)
            )
        }

        // Fixture limpio y "de a mano": 1 palet * 1 unidad/palet (por defecto) = 1 unidad.
        // rawMaterialCost = costPerUnit(1) * quantityValue(100) * totalUnits(1) = 100
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
                    productIngredients: [{ ingredientId: 1, quantityValue: 100, usedIngredient: { displayName: "X", costPerUnit: 1 } }]
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

            const quote1 = await quoteService.saveQuote(42, { productVariantId: 10, destinationId: 900, requestedPallets: 1, leadContact: LEAD_CONTACT })
            expect(quote1.percentageCostTotal).toBe(3)

            // El admin ahora desactiva "Imprevistos" (catálogo cambia) y se cotiza un pedido NUEVO.
            stubProcessingCosts() // ninguna fila activa de ningún tipo
            mockQuoteCreate.mockResolvedValueOnce({ id: 2, get: () => new Date("2026-01-02T00:00:00Z") })

            const quote2 = await quoteService.saveQuote(42, { productVariantId: 10, destinationId: 900, requestedPallets: 1, leadContact: LEAD_CONTACT })
            expect(quote2.percentageCostTotal).toBe(0)

            // Lo que YA se persistió en la primera llamada sigue con el valor congelado (Q3).
            expect(mockQuoteCreate.mock.calls[0][0]).toMatchObject({ percentageCostTotal: 3 })
            expect(mockQuoteCreate.mock.calls[1][0]).toMatchObject({ percentageCostTotal: 0 })
            expect(quote1.percentageCostTotal).toBe(3)
            expect(quote1.breakdown.percentageCosts).toEqual([expect.objectContaining({ processingCostId: 1, lineTotal: 3 })])
        })
    })

    describe("receta fija con unidad de receta distinta a la de costeo (2026-08-27, se compra por libra, se usa por gramo)", () => {
        it("convierte quantityValue de quantityUnit a costUnit con baseFactor antes de multiplicar por costPerUnit", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        {
                            ingredientId: 1,
                            quantityValue: 100,
                            quantityUnit: { unitType: "weight", baseFactor: 1 }, // gramo
                            usedIngredient: {
                                displayName: "Sal",
                                costPerUnit: 10, // por libra
                                costUnit: { unitType: "weight", baseFactor: 453.592 }
                            }
                        }
                    ]
                },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            // 100g / 453.592 (g por libra) = 0.220462 lb -- rounding-safe, ver decimal.js.
            // rawMaterialCost = costPerUnit(10) * 0.220462... * totalUnits(1), redondeado a 4 decimales.
            expect(result.rawMaterialCost).toBe(2.2046)
        })

        it("mantiene el comportamiento histórico si la línea no tiene quantityUnit configurado (dato viejo, no rompe recetas ya cargadas)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
                    ]
                },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.rawMaterialCost).toBe(10) // 20 * 0.5, sin conversión
        })

        it("rechaza si quantityUnit y costUnit no son del mismo tipo (ej. receta en litros, costeo por libra)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 1,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        {
                            ingredientId: 1,
                            quantityValue: 100,
                            quantityUnit: { unitType: "volume", baseFactor: 1 },
                            usedIngredient: { costPerUnit: 10, costUnit: { unitType: "weight", baseFactor: 453.592 } }
                        }
                    ]
                },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({
                key: "errors.product_ingredient_quantity_unit_type_mismatch"
            })
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
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsita 100g", netWeightGrams: 100 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Bolsita individual", unitCost: 1 } }],
                usedIntermediatePackaging: { id: 8, displayName: "Bolsa grande", unitCost: 3 },
                palletMaterials: [
                    { packagingId: 6, quantityValue: 10, usedPalletMaterial: { displayName: "Caja corrugada", unitCost: 1 } }
                ]
            })
        }

        it("calcula el costo del empaque intermedio dividiendo totalUnits entre unitsPerIntermediatePackage y lo suma al total", async () => {
            // totalUnits = 20 (1 palet * 20 unidades/palet), 10 bolsitas por bolsa grande -> 2 bolsas grandes exactas
            stubVariantWithIntermediatePackaging(10)

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.breakdown.intermediatePackaging).toMatchObject({
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

            expect(result.breakdown.intermediatePackaging?.packagesNeeded).toBe(3)
            expect(result.intermediatePackagingCost).toBe(9) // 3 * 3
        })

        it("rechaza si la variante tiene empaque intermedio pero no unitsPerIntermediatePackage (dato viejo/incompleto, no asume nada en silencio)", async () => {
            stubVariantWithIntermediatePackaging(null)

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.intermediate_packaging_missing_units" })
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
                    productIngredients: [
                        {
                            ingredientId: 1,
                            minPercentage: null,
                            maxPercentage: null,
                            usedIngredient: {
                                displayName: "Piña convencional",
                                costPerUnit: 20,
                                costUnit: { unitType: "weight", baseFactor: 1000 }
                            }
                        },
                        {
                            ingredientId: 2,
                            minPercentage: null,
                            maxPercentage: null,
                            usedIngredient: {
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

        // Caso verificado a mano por el usuario contra el cotizador real en producción
        // (2026-08-10, ver memoria del proyecto) -- Q763.40 exacto. Si este test empieza a
        // fallar, es una señal directa de regresión en el motor de cálculo, no un falso positivo.
        it("reproduce el caso verificado en producción: 40% piña convencional + 59.9% piña orgánica = Q763.40", async () => {
            stubCustomizableVariant()

            const result = await quoteService.calculateQuote({
                ...baseInput,
                ingredientMix: [
                    { ingredientId: 1, percentage: 40 },
                    { ingredientId: 2, percentage: 59.9 }
                ]
            })

            // Antes de blindar el motor con decimal.js esto se comparaba con toBeCloseTo porque
            // la aritmética en floats nativos no garantizaba el centavo exacto (ver money.util.ts).
            // Ahora sí debe dar exacto -- si vuelve a fallar acá es señal de una regresión de
            // precisión, no un falso positivo por redondeo.
            expect(result.rawMaterialCost).toBe(679.4)
            expect(result.unitPackagingCost).toBe(20)
            expect(result.palletMaterialCost).toBe(14)
            expect(result.transportCost).toBe(50)
            expect(result.totalCost).toBe(763.4)
        })

        it("rechaza si no se manda ningún mix", async () => {
            stubCustomizableVariant()

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.ingredient_mix_required" })
        })

        it("rechaza si el mix no suma 100% (fuera de la tolerancia de 0.5)", async () => {
            stubCustomizableVariant()

            await expect(
                quoteService.calculateQuote({
                    ...baseInput,
                    ingredientMix: [
                        { ingredientId: 1, percentage: 40 },
                        { ingredientId: 2, percentage: 50 } // suma 90, desvío de 10
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.mix_percentage_must_total_100" })
        })

        it("acepta el mix justo en el borde de la tolerancia (±0.5)", async () => {
            stubCustomizableVariant()

            const result = await quoteService.calculateQuote({
                ...baseInput,
                ingredientMix: [
                    { ingredientId: 1, percentage: 40 },
                    { ingredientId: 2, percentage: 59.5 } // suma 99.5, desvío exacto de 0.5
                ]
            })

            expect(result.totalCost).toBeGreaterThan(0)
        })

        it("reconcilia exacto (sin diferencia de precisión) con un mix de 3 ingredientes en tercios (33.34/33.33/33.33) -- caso clásico de arrastre de error en floats nativos", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    displayName: "Mix de tercios",
                    productIngredients: [
                        { ingredientId: 1, minPercentage: null, maxPercentage: null, usedIngredient: { displayName: "A", costPerUnit: 17.37, costUnit: { unitType: "weight", baseFactor: 1000 } } },
                        { ingredientId: 2, minPercentage: null, maxPercentage: null, usedIngredient: { displayName: "B", costPerUnit: 9.21, costUnit: { unitType: "weight", baseFactor: 1000 } } },
                        { ingredientId: 3, minPercentage: null, maxPercentage: null, usedIngredient: { displayName: "C", costPerUnit: 23.05, costUnit: { unitType: "weight", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            const result = await quoteService.calculateQuote({
                ...baseInput,
                requestedPallets: 7,
                ingredientMix: [
                    { ingredientId: 1, percentage: 33.34 },
                    { ingredientId: 2, percentage: 33.33 },
                    { ingredientId: 3, percentage: 33.33 }
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
                    ingredientMix: [
                        { ingredientId: 1, percentage: 40 },
                        { ingredientId: 2, percentage: 59.49 } // suma 99.49, desvío de 0.51
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.mix_percentage_must_total_100" })
        })

        it("rechaza un ingrediente duplicado en el mix", async () => {
            stubCustomizableVariant()

            await expect(
                quoteService.calculateQuote({
                    ...baseInput,
                    ingredientMix: [
                        { ingredientId: 1, percentage: 50 },
                        { ingredientId: 1, percentage: 50 }
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.duplicate_ingredient_in_mix" })
        })

        it("rechaza un ingrediente que no está en el pool del producto", async () => {
            stubCustomizableVariant()

            await expect(
                quoteService.calculateQuote({
                    ...baseInput,
                    ingredientMix: [
                        { ingredientId: 999, percentage: 100 }
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.ingredient_not_in_pool" })
        })

        it("rechaza un porcentaje fuera de los límites min/max que puso el admin", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productIngredients: [
                        {
                            ingredientId: 1,
                            minPercentage: 20,
                            maxPercentage: 30,
                            usedIngredient: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } }
                        }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, ingredientMix: [{ ingredientId: 1, percentage: 80 }] })
            ).rejects.toMatchObject({ key: "errors.ingredient_percentage_out_of_range" })
        })

        it("acepta un porcentaje justo en el borde inclusivo del límite min/max (no lo rechaza por ser el borde)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productIngredients: [
                        {
                            ingredientId: 1,
                            minPercentage: 20,
                            maxPercentage: 30,
                            usedIngredient: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } }
                        },
                        {
                            ingredientId: 2,
                            minPercentage: null,
                            maxPercentage: null,
                            usedIngredient: { costPerUnit: 10, costUnit: { unitType: "weight", baseFactor: 1000 } }
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
                ingredientMix: [
                    { ingredientId: 1, percentage: 20 },
                    { ingredientId: 2, percentage: 80 }
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
                    productIngredients: [
                        {
                            ingredientId: 1,
                            minPercentage: null,
                            maxPercentage: 50,
                            usedIngredient: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } }
                        },
                        {
                            ingredientId: 2,
                            minPercentage: null,
                            maxPercentage: null,
                            usedIngredient: { costPerUnit: 10, costUnit: { unitType: "weight", baseFactor: 1000 } }
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
                ingredientMix: [
                    { ingredientId: 1, percentage: 1 },
                    { ingredientId: 2, percentage: 99 }
                ]
            })
            expect(result.totalCost).toBeGreaterThan(0)

            // percentage=51 (por encima de maxPercentage=50) debe rechazarse.
            await expect(
                quoteService.calculateQuote({
                    ...baseInput,
                    ingredientMix: [
                        { ingredientId: 1, percentage: 51 },
                        { ingredientId: 2, percentage: 49 }
                    ]
                })
            ).rejects.toMatchObject({ key: "errors.ingredient_percentage_out_of_range" })
        })

        it("cuando el admin solo puso minPercentage (maxPercentage null), el máximo real queda en 100", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productIngredients: [
                        {
                            ingredientId: 1,
                            minPercentage: 50,
                            maxPercentage: null,
                            usedIngredient: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } }
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
                ingredientMix: [{ ingredientId: 1, percentage: 100 }]
            })
            expect(result.totalCost).toBeGreaterThan(0)

            // percentage=49 (por debajo de minPercentage=50) debe rechazarse.
            await expect(
                quoteService.calculateQuote({ ...baseInput, ingredientMix: [{ ingredientId: 1, percentage: 49 }] })
            ).rejects.toMatchObject({ key: "errors.ingredient_percentage_out_of_range" })
        })

        it("rechaza si al ingrediente le falta costUnit (bug histórico: costos 'en millones')", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productIngredients: [
                        { ingredientId: 1, minPercentage: null, maxPercentage: null, usedIngredient: { costPerUnit: 20, costUnit: null } }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, ingredientMix: [{ ingredientId: 1, percentage: 100 }] })
            ).rejects.toMatchObject({ key: "errors.ingredient_missing_cost_unit" })
        })

        it("rechaza si el costUnit del ingrediente no es de peso (bug histórico: unitType no validado)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productIngredients: [
                        {
                            ingredientId: 1,
                            minPercentage: null,
                            maxPercentage: null,
                            usedIngredient: { costPerUnit: 20, costUnit: { unitType: "volume", baseFactor: 1000 } }
                        }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, ingredientMix: [{ ingredientId: 1, percentage: 100 }] })
            ).rejects.toMatchObject({ key: "errors.ingredient_cost_unit_type_mismatch" })
        })

        it("rechaza si la presentación no tiene netWeightGrams", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: {
                    isCustomizable: true,
                    productIngredients: [
                        { ingredientId: 1, minPercentage: null, maxPercentage: null, usedIngredient: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: null },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, ingredientMix: [{ ingredientId: 1, percentage: 100 }] })
            ).rejects.toMatchObject({ key: "errors.presentation_missing_net_weight" })
        })
    })

    describe("etiqueta compuesta de la variante (variantLabel, 2026-09-13)", () => {
        // Mismo formato que el selector de SKU del cliente (quoteCalculatorForm.component.tsx,
        // frontend): "{{bagsPerBox}} und × {{presentacion}} · {{boxesPerPallet}} cajas/palet".
        // No incluye el nombre del producto -- productDisplayName va aparte (ver comentario en
        // quote.service.ts) y los consumidores (quotedOrderSummary/quotePdfDocument/
        // adminQuote.page.tsx) ya lo anteponen ellos mismos.
        function stubVariantForLabel(overrides: { sizePresentation?: { displayLabel: string } | undefined } = {}): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 385,
                bagsPerBox: 6,
                parentProduct: { isCustomizable: false, displayName: "Jugo Piña Zanahoria Vidassa", productIngredients: [] },
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
        stubLead()
    })

    it("nunca confía en el desglose del cliente: siempre persiste lo que devuelve calculateQuote, no el input recibido", async () => {
        mockVariantFindOne.mockResolvedValue({
            id: 10,
            boxesPerPallet: 20,
            bagsPerBox: 1,
            parentProduct: {
                isCustomizable: false,
                displayName: "Piña en Trozos",
                productIngredients: [
                    { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
                ]
            },
            sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 2000 },
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
            leadContact: LEAD_CONTACT,
        } as SaveQuoteInput

        const saved = await quoteService.saveQuote(42, tamperedInput)

        // rawMaterialCost(200) + unitPackagingCost(20) + palletMaterialCost(0, material de $0) + transportCost(50)
        expect(saved.totalCost).toBe(270) // recalculado server-side, no 999999
        expect(mockQuoteCreate).toHaveBeenCalledWith(
            expect.objectContaining({ customerId: 42, totalCost: 270, processingCostTotal: 0 })
        )
    })

    describe("vínculo con Lead (prospecto), 2026-09-13 -- crear-o-reusar por email", () => {
        const baseSaveInput = { productVariantId: 10, destinationId: 900, requestedPallets: 1 }

        function stubMinimalVariantForLead(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                boxesPerPallet: 20,
                bagsPerBox: 1,
                parentProduct: { isCustomizable: false, displayName: "Piña en Trozos", productIngredients: [] },
                unitMaterials: [{ packagingId: 5, quantityPerUnit: 1, usedUnitMaterial: { id: 5, displayName: "Empaque", unitCost: 0 } }],
                palletMaterials: [{ packagingId: 6, quantityValue: 1, usedPalletMaterial: { displayName: "Caja", unitCost: 0 } }]
            })
        }

        it("crea un Lead nuevo y persiste su id en Quote.leadId cuando no existe ninguno con ese email", async () => {
            stubMinimalVariantForLead()
            stubLead() // sin lead existente -> findOrCreateLeadForQuote crea uno (id 500, ver LEAD_CONTACT)
            mockQuoteCreate.mockResolvedValue({ id: 600, get: () => new Date("2026-09-13T00:00:00Z") })

            const saved = await quoteService.saveQuote(42, { ...baseSaveInput, leadContact: LEAD_CONTACT })

            expect(saved.leadId).toBe(500)
            expect(mockQuoteCreate).toHaveBeenCalledWith(expect.objectContaining({ leadId: 500 }))
        })

        it("REUSA un Lead ya existente con ese email en vez de crear uno duplicado", async () => {
            stubMinimalVariantForLead()
            stubLead({ existing: { id: 42424 } })
            mockQuoteCreate.mockResolvedValue({ id: 601, get: () => new Date("2026-09-13T00:00:00Z") })

            const saved = await quoteService.saveQuote(42, { ...baseSaveInput, leadContact: LEAD_CONTACT })

            expect(saved.leadId).toBe(42424)
            expect(mockLeadCreate).not.toHaveBeenCalled()
            expect(mockQuoteCreate).toHaveBeenCalledWith(expect.objectContaining({ leadId: 42424 }))
        })

        it("nunca confía en un leadId que el front intente mandar directo -- solo usa el que resuelve findOrCreateLeadForQuote", async () => {
            stubMinimalVariantForLead()
            stubLead({ existing: { id: 7 } })
            mockQuoteCreate.mockResolvedValue({ id: 602, get: () => new Date("2026-09-13T00:00:00Z") })

            const tamperedInput = { ...baseSaveInput, leadContact: LEAD_CONTACT, leadId: 999999 } as SaveQuoteInput
            const saved = await quoteService.saveQuote(42, tamperedInput)

            expect(saved.leadId).toBe(7) // no 999999
            expect(mockQuoteCreate).toHaveBeenCalledWith(expect.objectContaining({ leadId: 7 }))
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
                productIngredients: [
                    { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
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
            leadContact: LEAD_CONTACT,
        } as SaveQuoteInput

        const saved = await quoteService.saveQuote(42, tamperedInput)

        // totalUnits = 1 palet * 1 unidad/palet = 1; 1 unidad de exactamente 1 libra * Q1/lb = Q1.
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

        const quote1 = await quoteService.saveQuote(42, { productVariantId: 10, destinationId: 900, requestedPallets: 1, leadContact: LEAD_CONTACT })
        expect(quote1.processingCostTotal).toBe(3) // 1 libra * Q3/lb

        // El admin ahora desactiva el costo (simula "el catálogo cambió después") y se cotiza
        // un pedido NUEVO -- esto no debe tocar en absoluto lo que ya se guardó en quote1.
        mockProcessingCostFindAll.mockResolvedValue([])
        mockQuoteCreate.mockResolvedValueOnce({ id: 2, get: () => new Date("2026-01-02T00:00:00Z") })

        const quote2 = await quoteService.saveQuote(42, { productVariantId: 10, destinationId: 900, requestedPallets: 1, leadContact: LEAD_CONTACT })
        expect(quote2.processingCostTotal).toBe(0)

    
        expect(mockQuoteCreate.mock.calls[0][0]).toMatchObject({ processingCostTotal: 3 })
        expect(mockQuoteCreate.mock.calls[1][0]).toMatchObject({ processingCostTotal: 0 })
        // Y el resultado ya devuelto de la primera llamada (lo que viajó a la respuesta HTTP)
        // tampoco se muta después por la segunda llamada.
        expect(quote1.processingCostTotal).toBe(3)
        expect(quote1.breakdown.processingCosts).toEqual([expect.objectContaining({ processingCostId: 1, lineTotal: 3 })])
    })
})
