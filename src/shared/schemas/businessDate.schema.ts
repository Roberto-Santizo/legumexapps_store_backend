import { z } from "zod"
import { isValidIsoDate } from "../utils/businessTime.util"

// Día calendario "YYYY-MM-DD" en hora de Guatemala (tal como lo produce un <input type="date">), NO un
// instante: los servicios lo convierten a límites de día locales (businessDayRangeFilter).
export const businessDateSchema = z.string().refine(isValidIsoDate, { message: "Fecha inválida, se espera YYYY-MM-DD" })

// Comparación lexicográfica válida: ambos son YYYY-MM-DD.
export function isBusinessDateRangeOrdered(data: { startDate?: string; endDate?: string }): boolean {
    return !data.startDate || !data.endDate || data.startDate <= data.endDate
}
