import { buildOrderProfit, buildProfitLine, parseProfitPerPound } from "./quoteProfit"

// Factor del sistema: 453.592 g por libra (catálogo de unidades; el mismo que los costos por libra).
// 2000 unidades de 454 g = 908 000 g = 2001.798974 lb netas.
const banana = { totalCost: 1234.5678, netWeightGrams: 454, totalUnits: 2000 }

describe("buildProfitLine", () => {
    it("ganancia = monto por libra × libras netas (peso neto × unidades); precio final = costo + ganancia", () => {
        expect(buildProfitLine(banana, 0.25)).toEqual({ netPounds: 2001.798974, profitPerPound: 0.25, profitTotal: 500.4497, finalPrice: 1735.0175 })
    })

    it("una libra exacta por unidad: la ganancia es monto × unidades", () => {
        expect(buildProfitLine({ totalCost: 10, netWeightGrams: 453.592, totalUnits: 100 }, "0.5")).toMatchObject({ netPounds: 100, profitTotal: 50, finalPrice: 60 })
    })

    it("acepta los DECIMAL que pg devuelve como string (costo, peso y monto)", () => {
        expect(buildProfitLine({ totalCost: "1234.5678", netWeightGrams: "454", totalUnits: 2000 }, "0.25")).toEqual(buildProfitLine(banana, 0.25))
    })

    it("ganancia 0 = vender a costo: el precio final es exactamente el costo", () => {
        expect(buildProfitLine(banana, 0)).toMatchObject({ profitTotal: 0, finalPrice: 1234.5678 })
    })

    it("jugos: misma fórmula con el peso neto de su presentación (12 oz ≈ 355 g)", () => {
        expect(buildProfitLine({ totalCost: 209.35, netWeightGrams: 355, totalUnits: 546 }, 0.1)).toMatchObject({ netPounds: 427.322351, profitTotal: 42.7322, finalPrice: 252.0822 })
    })

    it("nunca modifica la línea de entrada (el costo congelado queda intacto)", () => {
        const line = { ...banana }
        buildProfitLine(line, 0.25)
        expect(line).toEqual(banana)
    })

    it.each([null, undefined, 0, -454, "abc"])("sin peso neto válido (%p) rechaza: nunca asume una ganancia de 0", netWeightGrams => {
        expect(() => buildProfitLine({ ...banana, netWeightGrams: netWeightGrams as never }, 0.25)).toThrow(expect.objectContaining({ statusCode: 422, key: "errors.profit_net_weight_missing" }))
    })

    it.each([0, -1, 1.5])("rechaza unidades inválidas (%p)", totalUnits => {
        expect(() => buildProfitLine({ ...banana, totalUnits }, 0.25)).toThrow(expect.objectContaining({ key: "errors.profit_net_weight_missing" }))
    })
})

describe("parseProfitPerPound", () => {
    it.each([0, "0", 0.25, "0.2500", 3, "1.2345", 5, "5.0000"])("acepta %p (de 0 al tope de 5)", value => {
        expect(() => parseProfitPerPound(value)).not.toThrow()
    })

    it.each([-0.01, "-1", "1.23456", 0.00001, Number.NaN, Number.POSITIVE_INFINITY, "abc", ""])("rechaza %p sin redondear en silencio", value => {
        expect(() => parseProfitPerPound(value)).toThrow(expect.objectContaining({ statusCode: 422, key: "errors.profit_per_pound_invalid" }))
    })

    it.each([5.0001, 25, "250"])("rechaza %p por encima del tope (error de tecleo como 25 en lugar de 0.25)", value => {
        expect(() => parseProfitPerPound(value)).toThrow(expect.objectContaining({ key: "errors.profit_per_pound_invalid", params: { max: 5 } }))
    })
})

describe("buildOrderProfit", () => {
    it("un solo monto por libra para todo el pedido; cada línea según sus libras y los totales suman las líneas", () => {
        const juice = { totalCost: "209.35", netWeightGrams: 355, totalUnits: 546 }
        const order = buildOrderProfit([banana, juice], "0.25")
        expect(order.lines).toEqual([buildProfitLine(banana, 0.25), buildProfitLine(juice, 0.25)])
        expect(order).toMatchObject({ profitPerPound: 0.25, totalCost: 1443.9178, netPounds: 2429.121325 })
        // 500.4497 + 106.8306 (cada línea ya redondeada) y 1443.9178 + 607.2803.
        expect(order.profitTotal).toBe(607.2803)
        expect(order.finalPrice).toBe(2051.1981)
    })

    it("una línea sin peso neto invalida todo el pedido: nunca un precio parcial", () => {
        expect(() => buildOrderProfit([banana, { ...banana, netWeightGrams: null }], 0.25)).toThrow(expect.objectContaining({ key: "errors.profit_net_weight_missing" }))
    })

    it("valida el monto una sola vez antes de calcular cualquier línea", () => {
        expect(() => buildOrderProfit([banana], -1)).toThrow(expect.objectContaining({ key: "errors.profit_per_pound_invalid" }))
    })
})
