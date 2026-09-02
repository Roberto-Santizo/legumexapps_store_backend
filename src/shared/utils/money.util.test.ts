import Decimal from "decimal.js"
import { toDecimal, roundMoney, sumMoney } from "./money.util"

// Este archivo no tenía pruebas propias -- es el único punto de redondeo/conversión monetaria
// de todo el motor de cálculo (ver comentario de cabecera en money.util.ts). Cualquier bug acá
// se propaga silenciosamente a quoteService.calculateQuote y a cualquier otra feature que sume
// dinero (dashboardService).

describe("toDecimal", () => {
    it("convierte null a Decimal(0)", () => {
        expect(toDecimal(null).toNumber()).toBe(0)
    })

    it("convierte undefined a Decimal(0)", () => {
        expect(toDecimal(undefined).toNumber()).toBe(0)
    })

    it("convierte un number", () => {
        expect(toDecimal(12.5).toNumber()).toBe(12.5)
    })

    it("convierte un string numérico (ej. columna DECIMAL de Postgres, que Sequelize devuelve como string)", () => {
        expect(toDecimal("12.5000").toNumber()).toBe(12.5)
    })

    it("convierte 0 explícito (no debe confundirse con null/undefined)", () => {
        expect(toDecimal(0).toNumber()).toBe(0)
    })
})

describe("roundMoney", () => {
    it("redondea a 4 decimales (MONEY_DECIMALS)", () => {
        expect(roundMoney(new Decimal("1.23456"))).toBe(1.2346)
    })

    it("no toca un valor que ya tiene 4 decimales o menos", () => {
        expect(roundMoney(new Decimal("1.2345"))).toBe(1.2345)
        expect(roundMoney(new Decimal("1.2"))).toBe(1.2)
        expect(roundMoney(new Decimal(0))).toBe(0)
    })

    it("redondea half-up (away from zero) en el borde exacto, igual que NUMERIC de Postgres", () => {
        // 0.00005 al quinto decimal -- el borde exacto de redondeo a 4 decimales.
        expect(roundMoney(new Decimal("1.00005"))).toBe(1.0001)
        expect(roundMoney(new Decimal("1.00015"))).toBe(1.0002)
    })

    it("redondea half-up también para negativos (away from zero, no half-up hacia +infinito)", () => {
        // Nunca deberían aparecer costos negativos en el dominio real, pero roundMoney no debe
        // comportarse de forma sorpresiva si algún día se usa para una resta (ej. descuentos,
        // Fase 5 pendiente según la memoria del proyecto).
        expect(roundMoney(new Decimal("-1.00005"))).toBe(-1.0001)
    })

    it("no arrastra el error de representación binaria de floats nativos (caso clásico 0.1 + 0.2)", () => {
        const sum = new Decimal("0.1").plus(new Decimal("0.2"))
        expect(roundMoney(sum)).toBe(0.3)
    })
})

describe("sumMoney", () => {
    it("suma un arreglo vacío como 0", () => {
        expect(sumMoney([])).toBe(0)
    })

    it("suma valores exactos sin ruido de precisión", () => {
        expect(sumMoney([0.1, 0.2])).toBe(0.3)
    })

    it("reproduce sin arrastre de error el caso clásico que sí falla con Array.reduce + `+` nativo (0.1 + 0.2 + 0.0001)", () => {
        // Con floats nativos esto da 0.30010000000000003 (ver Number.prototype.toString), no
        // 0.3001 -- justo el tipo de ruido que money.util.ts existe para eliminar. Si sumMoney
        // alguna vez se reimplementa con `+` nativo en vez de decimal.js, este test lo detecta.
        const nativeSum = 0.1 + 0.2 + 0.0001
        expect(nativeSum).not.toBe(0.3001) // confirma que el caso realmente dispara el bug en JS nativo

        expect(sumMoney([0.1, 0.2, 0.0001])).toBe(0.3001)
    })

    it("suma muchas líneas de 4 decimales sin drift acumulado (escala de un desglose real con docenas de líneas)", () => {
        const lines = Array.from({ length: 50 }, (_, i) => 0.0001 * (i + 1)) // 0.0001, 0.0002, ..., 0.005
        // Suma exacta esperada: 0.0001 * (1+2+...+50) = 0.0001 * 1275 = 0.1275
        expect(sumMoney(lines)).toBe(0.1275)
    })

    it("redondea el total a 4 decimales aunque las líneas individuales tengan más precisión", () => {
        expect(sumMoney([1 / 3, 1 / 3, 1 / 3])).toBe(1) // 0.3333... x3 = 1 exacto, no 0.9999
    })

    it("trata null/undefined-like (0) igual que roundMoney/toDecimal -- no revienta con líneas vacías", () => {
        expect(sumMoney([0, 0, 0])).toBe(0)
    })
})
