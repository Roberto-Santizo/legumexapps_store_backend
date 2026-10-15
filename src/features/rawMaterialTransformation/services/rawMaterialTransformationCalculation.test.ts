import { calculateTransformation, TransformationCalculationInput, TransformationCostInput } from "./rawMaterialTransformationCalculation"

// Valores esperados calculados de forma independiente con Python decimal (precisión 50), no con el
// motor bajo prueba.
const usd = (category: TransformationCostInput["category"], conceptName: string, amount: number): TransformationCostInput =>
    ({ category, conceptName, amount, currency: "USD", costBasis: "per_processed_pound" })

// Banano, hoja PCS.xlsx: materia prima Q0.52/lb, flete Q0, rendimiento 45 %, tipo de cambio 7.65.
const bananaBase: Omit<TransformationCalculationInput, "costs"> = {
    inputCostPerPound: 0.52, inputCurrency: "GTQ",
    freightPerPound: 0, freightCurrency: "GTQ",
    yieldPercentage: 45, exchangeRate: 7.65,
}

describe("calculateTransformation", () => {
    test("reproduces PCS.xlsx exactly when its per-pound USD values are entered (E19 = 0.22668685164944655)", () => {
        const result = calculateTransformation({
            ...bananaBase,
            costs: [
                usd("direct_labor", "LAVADO", 0.0051201704489003295),
                usd("direct_labor", "RECORTE", 0.04829557732917848),
                usd("direct_labor", "PROCESO", 0.009125984810098001),
                // El Excel calcula bolsa y sticker con 7.6 (no 7.65): se ingresan sus valores en USD.
                usd("packaging", "BOLSA", 0.005460526315789474),
                usd("packaging", "STICKER", 0.0026315789473684214),
                usd("other", "ELECTRICIDAD", 0),
                usd("other", "BUNKER O DIESEL", 0),
                usd("other", "SANITIZACIÓN", 0.005),
            ],
        })
        expect(result.inputCostUsdPerPound).toBe(0.067973856209)
        expect(result.rawMaterialCostUsd).toBe(0.151053013798)
        expect(result.processedCostUsd).toBe(0.226686851649)
        expect(result.catalogCostPerPound).toBe(0.2267)
        expect(result.lines).toHaveLength(8)
        expect(result.lines[5].costUsdPerProcessedPound).toBe(0)
    })

    test("banana with the rounded USD values from the specification -> 0.226688013798 (0.2267 in the catalog)", () => {
        const result = calculateTransformation({
            ...bananaBase,
            costs: [
                usd("direct_labor", "Lavado", 0.00512), usd("direct_labor", "Recorte", 0.048296), usd("direct_labor", "Proceso", 0.009126),
                usd("packaging", "Bolsa", 0.005461), usd("packaging", "Sticker", 0.002632),
                usd("other", "Sanitización", 0.005),
            ],
        })
        expect(result.directLaborCostUsd).toBe(0.062542)
        expect(result.packagingCostUsd).toBe(0.008093)
        expect(result.otherCostUsd).toBe(0.005)
        expect(result.processedCostUsd).toBe(0.226688013798)
        expect(result.catalogCostPerPound).toBe(0.2267)
    })

    test("bag and sticker entered in GTQ per unit with ONE exchange rate differ from the sheet's mixed 7.65/7.6 by -0.0000529", () => {
        const result = calculateTransformation({
            ...bananaBase,
            costs: [
                usd("direct_labor", "LAVADO", 0.0051201704489003295),
                usd("direct_labor", "RECORTE", 0.04829557732917848),
                usd("direct_labor", "PROCESO", 0.009125984810098001),
                // Bolsa Q0.83 para 20 lb; sticker Q0.20, dos por bolsa = 10 lb por sticker.
                { category: "packaging", conceptName: "BOLSA", amount: 0.83, currency: "GTQ", costBasis: "per_unit", poundsPerUnit: 20 },
                { category: "packaging", conceptName: "STICKER", amount: 0.2, currency: "GTQ", costBasis: "per_unit", poundsPerUnit: 10 },
                usd("other", "SANITIZACIÓN", 0.005),
            ],
        })
        expect(result.lines[3].costUsdPerProcessedPound).toBe(0.005424836601)
        expect(result.lines[4].costUsdPerProcessedPound).toBe(0.002614379085)
        expect(result.processedCostUsd).toBe(0.226633962073)
        expect(result.catalogCostPerPound).toBe(0.2266)
    })

    test("yield scales raw material and freight; per-input-pound costs are divided by the yield", () => {
        const result = calculateTransformation({
            inputCostPerPound: 2, inputCurrency: "USD", freightPerPound: 0.1, freightCurrency: "USD",
            yieldPercentage: 90, exchangeRate: 7.7,
            costs: [{ category: "other", conceptName: "Electricidad", amount: 0.09, currency: "USD", costBasis: "per_input_pound" }],
        })
        expect(result.rawMaterialCostUsd).toBe(2.333333333333)
        expect(result.otherCostUsd).toBe(0.1)
        expect(result.processedCostUsd).toBe(2.433333333333)
    })

    test("100 % yield keeps the input cost; GTQ freight is converted with the same rate", () => {
        const result = calculateTransformation({
            inputCostPerPound: 7.7, inputCurrency: "GTQ", freightPerPound: 0.77, freightCurrency: "GTQ",
            yieldPercentage: 100, exchangeRate: 7.7, costs: [],
        })
        expect(result.inputCostUsdPerPound).toBe(1)
        expect(result.freightUsdPerPound).toBe(0.1)
        expect(result.processedCostUsd).toBe(1.1)
    })

    test("a lower yield always raises the processed cost", () => {
        const at = (yieldPercentage: number) => calculateTransformation({ ...bananaBase, yieldPercentage, costs: [] }).processedCostUsd
        expect(at(30)).toBeGreaterThan(at(45))
        expect(at(45)).toBeGreaterThan(at(80))
    })

    test("all-zero additional costs and no costs give the same result", () => {
        const zeros = calculateTransformation({ ...bananaBase, costs: [usd("direct_labor", "Lavado", 0), usd("packaging", "Bolsa", 0), usd("other", "Diésel", 0)] })
        const none = calculateTransformation({ ...bananaBase, costs: [] })
        expect(zeros.processedCostUsd).toBe(none.processedCostUsd)
        expect(zeros.directLaborCostUsd).toBe(0)
    })

    test("many concepts per category are summed exactly (no float drift)", () => {
        const costs = Array.from({ length: 60 }, (_, index) => usd(["direct_labor", "packaging", "other"][index % 3] as TransformationCostInput["category"], `C${index}`, 0.1))
        const result = calculateTransformation({ ...bananaBase, inputCostPerPound: 0, costs })
        expect(result.directLaborCostUsd).toBe(2)
        expect(result.packagingCostUsd).toBe(2)
        expect(result.otherCostUsd).toBe(2)
        expect(result.processedCostUsd).toBe(6)
    })

    test("per-batch cost is divided by the processed pounds of the batch", () => {
        const result = calculateTransformation({
            ...bananaBase, inputCostPerPound: 0,
            costs: [{ category: "other", conceptName: "Diésel", amount: 770, currency: "GTQ", costBasis: "per_batch", poundsPerUnit: 1000 }],
        })
        expect(result.otherCostUsd).toBe(0.100653594771)
    })

    test.each([0, -5, 100.01])("rejects yield %p", yieldPercentage => {
        expect(() => calculateTransformation({ ...bananaBase, yieldPercentage, costs: [] }))
            .toThrow(expect.objectContaining({ statusCode: 422, key: "errors.raw_material_transformation_invalid_yield" }))
    })

    test.each([0, -1])("rejects exchange rate %p", exchangeRate => {
        expect(() => calculateTransformation({ ...bananaBase, exchangeRate, costs: [] }))
            .toThrow(expect.objectContaining({ key: "errors.raw_material_transformation_invalid_exchange_rate" }))
    })

    test("per-unit cost without pounds per unit is rejected naming the concept", () => {
        expect(() => calculateTransformation({ ...bananaBase, costs: [{ category: "packaging", conceptName: "Bolsa", amount: 1, currency: "GTQ", costBasis: "per_unit" }] }))
            .toThrow(expect.objectContaining({ key: "errors.raw_material_transformation_pounds_per_unit_required", params: { concept: "Bolsa" } }))
    })

    test("per-pound cost with pounds per unit is rejected", () => {
        expect(() => calculateTransformation({ ...bananaBase, costs: [{ ...usd("other", "Luz", 1), poundsPerUnit: 5 }] }))
            .toThrow(expect.objectContaining({ key: "errors.raw_material_transformation_pounds_per_unit_not_allowed" }))
    })
})
