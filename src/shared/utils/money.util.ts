import Decimal from "decimal.js"

// Punto único de conversión/redondeo para cualquier cálculo monetario del cotizador. decimal.js hace
// la aritmética exacta en base 10 (sin el problema de 0.1 + 0.2 !== 0.3) y roundMoney() es el ÚNICO
// lugar donde se decide a cuántos decimales se corta un monto, para que las columnas DECIMAL y el
// breakdown JSONB guarden siempre el mismo número.

// Precisión interna para cualquier cálculo monetario (decisión de negocio: hasta 4 decimales): cortar
// a 2 en cada línea intermedia pierde precisión con costos unitarios pequeños multiplicados por miles
// de unidades. Las columnas DECIMAL de dinero tienen escala 4 para no truncar al persistir. La UI sigue
// mostrando 2 decimales a propósito (formatCurrency). Es el único número a tocar en el motor si cambia
// la cantidad de decimales.
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
