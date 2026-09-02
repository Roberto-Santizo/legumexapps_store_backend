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

import ProductVariant from "../../product/models/ProductVariant.model"
import Destination from "../../destination/models/Destination.model"
import Quote from "../models/Quote.model"
import { quoteService } from "./quote.service"
import { NotFoundError } from "../../../shared/errors/AppError"
import { CalculateQuoteInput } from "../schemas/quote.schema"

const mockVariantFindOne = ProductVariant.findOne as unknown as jest.Mock
const mockDestinationFindOne = Destination.findOne as unknown as jest.Mock
const mockQuoteCreate = Quote.create as unknown as jest.Mock

// Costo de destino usado en todos los casos salvo que un test lo pise explícitamente.
const DESTINATION = { id: 900, displayName: "Puerto Cortés", baseCost: 50 }

function stubDestination(overrides: Partial<typeof DESTINATION> = {}): void {
    mockDestinationFindOne.mockResolvedValue({ ...DESTINATION, ...overrides })
}

describe("quoteService.calculateQuote", () => {
    beforeEach(() => {
        stubDestination()
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
            mockVariantFindOne.mockResolvedValue({ id: 10, unitsPerPallet: 20, parentProduct: { isCustomizable: false, productIngredients: [] } })
            mockDestinationFindOne.mockResolvedValue(null)

            await expect(quoteService.calculateQuote(baseInput)).rejects.toBeInstanceOf(NotFoundError)
        })

        it("rechaza si la variante no tiene unitsPerPallet configurado (bug histórico: cotizar sin palet configurado)", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, unitsPerPallet: null, parentProduct: { isCustomizable: false, productIngredients: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })

        it("rechaza unitsPerPallet en 0 igual que null", async () => {
            mockVariantFindOne.mockResolvedValue({ id: 10, unitsPerPallet: 0, parentProduct: { isCustomizable: false, productIngredients: [] } })

            await expect(quoteService.calculateQuote(baseInput)).rejects.toMatchObject({ key: "errors.pallet_not_configured" })
        })
    })

    describe("receta fija (producto no personalizable)", () => {
        function stubFixedRecipeVariant(): void {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 20,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Piña en Trozos",
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 2000 },
                usedPackaging: { id: 5, displayName: "Bolsa plástica", unitCost: 1 },
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
                unitsPerPallet: 1,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 1, usedIngredient: { displayName: "Trazas", costPerUnit: 0.1234 } }
                    ]
                },
                usedPackaging: null,
                palletMaterials: []
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

        it("no revienta si el producto no tiene empaque unitario asignado", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 20,
                parentProduct: { isCustomizable: false, productIngredients: [] },
                usedPackaging: null,
                palletMaterials: []
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.unitPackagingCost).toBe(0)
            expect(result.breakdown.unitPackaging).toBeNull()
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
                unitsPerPallet: 20,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 5, usedIngredient: { displayName: "Agua", costPerUnit: 0 } }
                    ]
                },
                usedPackaging: null,
                palletMaterials: []
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.rawMaterialCost).toBe(0)
            expect(result.breakdown.rawMaterials[0].lineTotal).toBe(0)
            expect(Number.isNaN(result.totalCost)).toBe(false)
        })

        it("no revienta con quantityValue = 0 en un material de palet -- la línea da 0, no negativo ni NaN", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 20,
                parentProduct: { isCustomizable: false, productIngredients: [] },
                usedPackaging: null,
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
                unitsPerPallet: 1,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 1, usedIngredient: { displayName: "A", costPerUnit: 0.1 } },
                        { ingredientId: 2, quantityValue: 1, usedIngredient: { displayName: "B", costPerUnit: 0.2 } },
                        { ingredientId: 3, quantityValue: 1, usedIngredient: { displayName: "C", costPerUnit: 0.0001 } }
                    ]
                },
                usedPackaging: null,
                palletMaterials: []
            })

            const result = await quoteService.calculateQuote(baseInput)

            // 0.1 + 0.2 + 0.0001 da 0.30010000000000003 con `+` nativo -- debe dar exacto 0.3001.
            expect(result.rawMaterialCost).toBe(0.3001)
        })

        it("escala sin arrastre de precisión con cantidades grandes de palets (multiplicación a gran escala)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 500,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.3333, usedIngredient: { displayName: "A", costPerUnit: 7.77 } }
                    ]
                },
                usedPackaging: { id: 5, displayName: "Bolsa", unitCost: 1.11 },
                palletMaterials: []
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
                unitsPerPallet: 20,
                parentProduct: { isCustomizable: false, productIngredients: [], additionalCostPerUnit },
                usedPackaging: null,
                palletMaterials: []
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
                unitsPerPallet: 20,
                parentProduct: { isCustomizable: false, productIngredients: [] },
                usedPackaging: null,
                palletMaterials: []
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.adjustmentCost).toBe(0)
            expect(result.breakdown.adjustment).toBeNull()
        })
    })

    describe("receta fija con unidad de receta distinta a la de costeo (2026-08-27, se compra por libra, se usa por gramo)", () => {
        it("convierte quantityValue de quantityUnit a costUnit con baseFactor antes de multiplicar por costPerUnit", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 1,
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
                usedPackaging: null,
                palletMaterials: []
            })

            const result = await quoteService.calculateQuote(baseInput)

            // 100g / 453.592 (g por libra) = 0.220462 lb -- rounding-safe, ver decimal.js.
            // rawMaterialCost = costPerUnit(10) * 0.220462... * totalUnits(1), redondeado a 4 decimales.
            expect(result.rawMaterialCost).toBe(2.2046)
        })

        it("mantiene el comportamiento histórico si la línea no tiene quantityUnit configurado (dato viejo, no rompe recetas ya cargadas)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 1,
                parentProduct: {
                    isCustomizable: false,
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
                    ]
                },
                usedPackaging: null,
                palletMaterials: []
            })

            const result = await quoteService.calculateQuote(baseInput)

            expect(result.rawMaterialCost).toBe(10) // 20 * 0.5, sin conversión
        })

        it("rechaza si quantityUnit y costUnit no son del mismo tipo (ej. receta en litros, costeo por libra)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 1,
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
                usedPackaging: null,
                palletMaterials: []
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
                unitsPerPallet: 20,
                unitsPerIntermediatePackage,
                parentProduct: {
                    isCustomizable: false,
                    displayName: "Snack en Porciones",
                    productIngredients: [
                        { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
                    ]
                },
                sizePresentation: { displayLabel: "Bolsita 100g", netWeightGrams: 100 },
                usedPackaging: { id: 5, displayName: "Bolsita individual", unitCost: 1 },
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
                unitsPerPallet: 20,
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
                usedPackaging: { id: 5, displayName: "Bolsa plástica", unitCost: 1 },
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
                unitsPerPallet: 20,
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
                usedPackaging: null,
                palletMaterials: []
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
                unitsPerPallet: 20,
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
                usedPackaging: null,
                palletMaterials: []
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, ingredientMix: [{ ingredientId: 1, percentage: 80 }] })
            ).rejects.toMatchObject({ key: "errors.ingredient_percentage_out_of_range" })
        })

        it("acepta un porcentaje justo en el borde inclusivo del límite min/max (no lo rechaza por ser el borde)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 20,
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
                usedPackaging: null,
                palletMaterials: []
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
                unitsPerPallet: 20,
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
                usedPackaging: null,
                palletMaterials: []
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
                unitsPerPallet: 20,
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
                usedPackaging: null,
                palletMaterials: []
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
                unitsPerPallet: 20,
                parentProduct: {
                    isCustomizable: true,
                    productIngredients: [
                        { ingredientId: 1, minPercentage: null, maxPercentage: null, usedIngredient: { costPerUnit: 20, costUnit: null } }
                    ]
                },
                sizePresentation: { netWeightGrams: 2000 },
                usedPackaging: null,
                palletMaterials: []
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, ingredientMix: [{ ingredientId: 1, percentage: 100 }] })
            ).rejects.toMatchObject({ key: "errors.ingredient_missing_cost_unit" })
        })

        it("rechaza si el costUnit del ingrediente no es de peso (bug histórico: unitType no validado)", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 20,
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
                usedPackaging: null,
                palletMaterials: []
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, ingredientMix: [{ ingredientId: 1, percentage: 100 }] })
            ).rejects.toMatchObject({ key: "errors.ingredient_cost_unit_type_mismatch" })
        })

        it("rechaza si la presentación no tiene netWeightGrams", async () => {
            mockVariantFindOne.mockResolvedValue({
                id: 10,
                unitsPerPallet: 20,
                parentProduct: {
                    isCustomizable: true,
                    productIngredients: [
                        { ingredientId: 1, minPercentage: null, maxPercentage: null, usedIngredient: { costPerUnit: 20, costUnit: { unitType: "weight", baseFactor: 1000 } } }
                    ]
                },
                sizePresentation: { netWeightGrams: null },
                usedPackaging: null,
                palletMaterials: []
            })

            await expect(
                quoteService.calculateQuote({ ...baseInput, ingredientMix: [{ ingredientId: 1, percentage: 100 }] })
            ).rejects.toMatchObject({ key: "errors.presentation_missing_net_weight" })
        })
    })
})

describe("quoteService.saveQuote", () => {
    beforeEach(() => {
        stubDestination()
    })

    it("nunca confía en el desglose del cliente: siempre persiste lo que devuelve calculateQuote, no el input recibido", async () => {
        mockVariantFindOne.mockResolvedValue({
            id: 10,
            unitsPerPallet: 20,
            parentProduct: {
                isCustomizable: false,
                displayName: "Piña en Trozos",
                productIngredients: [
                    { ingredientId: 1, quantityValue: 0.5, usedIngredient: { displayName: "Piña", costPerUnit: 20 } }
                ]
            },
            sizePresentation: { displayLabel: "Bolsa 2kg", netWeightGrams: 2000 },
            usedPackaging: { id: 5, displayName: "Bolsa plástica", unitCost: 1 },
            palletMaterials: []
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

        // rawMaterialCost(200) + unitPackagingCost(20) + palletMaterialCost(0, sin materiales) + transportCost(50)
        expect(saved.totalCost).toBe(270) // recalculado server-side, no 999999
        expect(mockQuoteCreate).toHaveBeenCalledWith(
            expect.objectContaining({ customerId: 42, totalCost: 270 })
        )
    })
})
