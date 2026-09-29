import { Op } from "sequelize"

// Zona horaria del negocio: TODO límite de día ("hoy", "del 1 al 7") y todo bucket de fecha se
// interpreta en hora de Guatemala, nunca en UTC. El frontend usa la misma zona para sus presets
// (feature/dashboard/util/presetRange.ts). No volver a UTC: después de las 18:00 locales el día UTC
// ya es "mañana" y las cotizaciones de la tarde caían fuera del rango / en el día siguiente.
export const BUSINESS_TIME_ZONE = "America/Guatemala"

// Guatemala no usa horario de verano: UTC-6 fijo todo el año (verificado contra Intl en
// businessTime.util.test.ts). Un offset fijo permite convertir en ambos sentidos sin Intl.
const BUSINESS_UTC_OFFSET_MS = -6 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseIsoDate(isoDate: string): number {
    const [year, month, day] = isoDate.split("-").map(Number)
    return Date.UTC(year, month - 1, day)
}

// true solo para "YYYY-MM-DD" que existe en el calendario ("2026-02-30" → false).
export function isValidIsoDate(value: string): boolean {
    if (!ISO_DATE_PATTERN.test(value)) return false
    return new Date(parseIsoDate(value)).toISOString().slice(0, 10) === value
}

// Instante UTC en que empieza (00:00:00.000 local) el día `isoDate` en Guatemala.
export function businessDayStart(isoDate: string): Date {
    return new Date(parseIsoDate(isoDate) - BUSINESS_UTC_OFFSET_MS)
}

// Instante UTC en que termina (23:59:59.999 local) el día `isoDate` en Guatemala.
export function businessDayEnd(isoDate: string): Date {
    return new Date(businessDayStart(isoDate).getTime() + MS_PER_DAY - 1)
}

// Día calendario ("YYYY-MM-DD") en Guatemala al que pertenece el instante `date`.
export function businessDayKey(date: Date): string {
    return new Date(date.getTime() + BUSINESS_UTC_OFFSET_MS).toISOString().slice(0, 10)
}

// Lunes (día local de Guatemala) de la semana ISO a la que pertenece `date`, como "YYYY-MM-DD".
export function businessWeekKey(date: Date): string {
    const localDay = new Date(parseIsoDate(businessDayKey(date)))
    const weekday = localDay.getUTCDay()
    const diffToMonday = weekday === 0 ? -6 : 1 - weekday
    localDay.setUTCDate(localDay.getUTCDate() + diffToMonday)
    return localDay.toISOString().slice(0, 10)
}

// Filtro Sequelize de un rango de días "YYYY-MM-DD" en Guatemala (inicio 00:00 local, fin 23:59:59.999
// local), para cualquier columna de fecha (dashboard: createdAt; borradores: updatedAt). Devuelve
// `undefined` si no se pidió ningún extremo -- se decide por los parámetros y no contando las claves,
// porque Op.gte/Op.lte son symbols y Object.keys no los ve.
export function businessDayRangeFilter(startDate?: string, endDate?: string): Record<symbol, Date> | undefined {
    if (!startDate && !endDate) return undefined
    const filter: Record<symbol, Date> = {}
    if (startDate) filter[Op.gte] = businessDayStart(startDate)
    if (endDate) filter[Op.lte] = businessDayEnd(endDate)
    return filter
}

// Días calendario entre dos "YYYY-MM-DD", contando ambos extremos ("2026-01-10".."2026-01-11" → 2).
export function inclusiveDaySpan(startIsoDate: string, endIsoDate: string): number {
    return Math.round((parseIsoDate(endIsoDate) - parseIsoDate(startIsoDate)) / MS_PER_DAY) + 1
}
