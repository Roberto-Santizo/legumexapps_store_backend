import Decimal from "decimal.js"

// Punto único de conversión/redondeo para cualquier cálculo monetario del cotizador (ver
// quoteService). Antes de esto, quote.service.ts casteaba DECIMAL de Postgres directo a
// `number` y operaba con floats nativos (IEEE 754) sin ningún redondeo explícito -- el error
// de representación de floats se acumulaba silenciosamente a través de multiplicaciones y
// divisiones encadenadas (% -> gramos -> conversión de unidad -> costo), y lo único que
// "ocultaba" el ruido era el formateo a 2 decimales en el front (Intl.NumberFormat). El
// breakdown JSONB guardaba esos floats crudos sin redondear mientras que las columnas DECIMAL
// de Quote sí las redondeaba Postgres al insertar -- dos motores de redondeo distintos para el
// mismo dato, sin política única. decimal.js hace la aritmética exacta en base 10 (sin el
// problema de 0.1 + 0.2 !== 0.3) y roundMoney() es el ÚNICO lugar donde se decide a cuántos
// decimales se corta un monto.

// Precisión interna para CUALQUIER cálculo monetario (2026-08-24, a pedido explícito del usuario:
// "para todas las operaciones matemáticas... hasta 4 decimales"). Antes eran 2 (centavos) --
// con costos unitarios muy pequeños multiplicados por miles de unidades/palets, cortar a 2
// decimales en cada línea intermedia perdía precisión real de forma acumulativa. Sube a 4 en
// las columnas DECIMAL de dinero que lo alimentan (Packaging.unitCost, Destination.baseCost,
// las 6 columnas de costo de Quote) para que este numero no se trunque de vuelta a 2 al
// persistir -- ver esa entrada de memoria del proyecto. El FORMATO que ve el cliente/admin en
// pantalla sigue en 2 decimales a propósito (formatCurrency, shared/format/currency.ts) --
// decisión de negocio explícita: más precisión internamente, mismo aspecto de moneda normal en
// la UI. Si algún día cambia la cantidad de decimales de la moneda, este es el único número a
// tocar en el motor de cálculo (las columnas DECIMAL de la BD son un cambio de schema aparte).
const MONEY_DECIMALS = 4

export function toDecimal(value: number | string | null | undefined): Decimal {
    if (value === null || value === undefined) return new Decimal(0)
    return new Decimal(value)
}

// Redondea a la precisión monetaria interna (MONEY_DECIMALS) con la misma regla que usa
// Postgres para NUMERIC (half-away-from-zero), así el valor que se guarda en las columnas
// DECIMAL y el que queda congelado en el breakdown JSONB son siempre el mismo número -- no dos
// redondeos independientes que puedan desalinearse.
export function roundMoney(value: Decimal): number {
    return value.toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP).toNumber()
}

// Suma línea a línea en Decimal (no con Array.prototype.reduce + `+` nativo) y redondea el
// resultado una sola vez al final -- evita que el subtotal difiera del redondeo individual de
// cada línea ya redondeada que se muestra en el breakdown.
export function sumMoney(values: number[]): number {
    return roundMoney(values.reduce((sum, value) => sum.plus(value), new Decimal(0)))
}
