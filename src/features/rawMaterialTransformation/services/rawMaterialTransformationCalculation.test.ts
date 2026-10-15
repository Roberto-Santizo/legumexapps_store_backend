import { calculateTransformation, TransformationCalculationInput, TransformationCostInput } from "./rawMaterialTransformationCalculation"

// Valores esperados calculados de forma independiente con Python decimal (precisión 50), no con el
// motor bajo prueba. Todos los importes están en USD.
const perLb = (category: TransformationCostInput["category"], conceptName: string, amount: number): TransformationCostInput =>
    ({ category, conceptName, amount, costBasis: "per_processed_pound" })

// Banano, hoja PCS.xlsx: materia prima en USD = celda E3 (Q0.52 / 7.65), flete 0, rendimiento 45 %.
const bananaBase: Omit<TransformationCalculationInput, "costs"> = {
    inputCostPerPound: 0.06797385620915032, freightPerPound: 0, yieldPercentage: 45,
}

describe("calculateTransformation (USD)", () => {
    test("reproduces PCS.xlsx exactly with its per-pound USD values (E19 = 0.22668685164944655)", () => {
        const result = calculateTransformation({
            ...bananaBase,
            costs: [
                perLb("direct_labor", "LAVADO", 0.0051201704489003295),
                perLb("direct_labor", "RECORTE", 0.04829557732917848),
                perLb("direct_labor", "PROCESO", 0.009125984810098001),
                perLb("packaging", "BOLSA", 0.005460526315789474),
                perLb("packaging", "STICKER", 0.0026315789473684214),
                perLb("other", "ELECTRICIDAD", 0),
                perLb("other", "BUNKER O DIESEL", 0),
                perLb("other", "SANITIZACIÓN", 0.005),
            ],
        })
        expect(result.inputCostUsdPerPound).toBe(0.067973856209)
        expect(result.rawMaterialCostUsd).toBe(0.151053013798)
        expect(result.processedCostUsd).toBe(0.226686851649)
        expect(result.catalogCostPerPound).toBe(0.2267)
        expect(result.lines).toHaveLength(8)
        expect(result.lines[5].costUsdPerProcessedPound).toBe(0)
    })

    test("banana with the rounded values from the specification -> 0.226688333333 (0.2267 in the catalog)", () => {
        const result = calculateTransformation({
            ...bananaBase,
            inputCostPerPound: 0.067974,
            costs: [
                perLb("direct_labor", "Lavado", 0.00512), perLb("direct_labor", "Recorte", 0.048296), perLb("direct_labor", "Proceso", 0.009126),
                perLb("packaging", "Bolsa", 0.005461), perLb("packaging", "Sticker", 0.002632),
                perLb("other", "Sanitización", 0.005),
            ],
        })
        expect(result.directLaborCostUsd).toBe(0.062542)
        expect(result.packagingCostUsd).toBe(0.008093)
        expect(result.otherCostUsd).toBe(0.005)
        expect(result.processedCostUsd).toBe(0.226688333333)
        expect(result.catalogCostPerPound).toBe(0.2267)
    })

    test("bag and sticker entered per unit are divided by the processed pounds each one covers", () => {
        const result = calculateTransformation({
            ...bananaBase,
            costs: [
                perLb("direct_labor", "LAVADO", 0.0051201704489003295),
                perLb("direct_labor", "RECORTE", 0.04829557732917848),
                perLb("direct_labor", "PROCESO", 0.009125984810098001),
                // Bolsa $0.1092 para 20 lb; sticker $0.0263, dos por bolsa = 10 lb por sticker.
                { category: "packaging", conceptName: "BOLSA", amount: 0.1092, costBasis: "per_unit", poundsPerUnit: 20 },
                { category: "packaging", conceptName: "STICKER", amount: 0.0263, costBasis: "per_unit", poundsPerUnit: 10 },
                perLb("other", "SANITIZACIÓN", 0.005),
            ],
        })
        expect(result.lines[3].costUsdPerProcessedPound).toBe(0.00546)
        expect(result.lines[4].costUsdPerProcessedPound).toBe(0.00263)
        expect(result.processedCostUsd).toBe(0.226684746386)
        expect(result.catalogCostPerPound).toBe(0.2267)
    })

    test("yield scales raw material and freight; per-input-pound costs are divided by the yield", () => {
        const result = calculateTransformation({
            inputCostPerPound: 2, freightPerPound: 0.1, yieldPercentage: 90,
            costs: [{ category: "other", conceptName: "Electricidad", amount: 0.09, costBasis: "per_input_pound" }],
        })
        expect(result.rawMaterialCostUsd).toBe(2.333333333333)
        expect(result.otherCostUsd).toBe(0.1)
        expect(result.processedCostUsd).toBe(2.433333333333)
    })

    test("100 % yield keeps input cost plus freight", () => {
        const result = calculateTransformation({ inputCostPerPound: 1, freightPerPound: 0.1, yieldPercentage: 100, costs: [] })
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
        const zeros = calculateTransformation({ ...bananaBase, costs: [perLb("direct_labor", "Lavado", 0), perLb("packaging", "Bolsa", 0), perLb("other", "Diésel", 0)] })
        const none = calculateTransformation({ ...bananaBase, costs: [] })
        expect(zeros.processedCostUsd).toBe(none.processedCostUsd)
        expect(zeros.directLaborCostUsd).toBe(0)
    })

    test("many concepts per category are summed exactly (no float drift)", () => {
        const costs = Array.from({ length: 60 }, (_, index) => perLb(["direct_labor", "packaging", "other"][index % 3] as TransformationCostInput["category"], `C${index}`, 0.1))
        const result = calculateTransformation({ ...bananaBase, inputCostPerPound: 0, costs })
        expect(result.directLaborCostUsd).toBe(2)
        expect(result.packagingCostUsd).toBe(2)
        expect(result.otherCostUsd).toBe(2)
        expect(result.processedCostUsd).toBe(6)
    })

    test("per-batch cost is divided by the processed pounds of the batch", () => {
        const result = calculateTransformation({
            ...bananaBase, inputCostPerPound: 0,
            costs: [{ category: "other", conceptName: "Diésel", amount: 100, costBasis: "per_batch", poundsPerUnit: 1000 }],
        })
        expect(result.otherCostUsd).toBe(0.1)
    })

    test.each([0, -5, 100.01])("rejects yield %p", yieldPercentage => {
        expect(() => calculateTransformation({ ...bananaBase, yieldPercentage, costs: [] }))
            .toThrow(expect.objectContaining({ statusCode: 422, key: "errors.raw_material_transformation_invalid_yield" }))
    })

    test("per-unit cost without pounds per unit is rejected naming the concept", () => {
        expect(() => calculateTransformation({ ...bananaBase, costs: [{ category: "packaging", conceptName: "Bolsa", amount: 1, costBasis: "per_unit" }] }))
            .toThrow(expect.objectContaining({ key: "errors.raw_material_transformation_pounds_per_unit_required", params: { concept: "Bolsa" } }))
    })

    test("per-pound cost with pounds per unit is rejected", () => {
        expect(() => calculateTransformation({ ...bananaBase, costs: [{ ...perLb("other", "Luz", 1), poundsPerUnit: 5 }] }))
            .toThrow(expect.objectContaining({ key: "errors.raw_material_transformation_pounds_per_unit_not_allowed" }))
    })
})
