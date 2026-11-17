import { businessDayKey } from "../../../shared/utils/businessTime.util"
import reference from "../constants/tejarLaborReference.json"
import type { LaborCalculationInput } from "../schemas/laborTemplate.schema"

// Only new calculations use today's calendar. Saved revision snapshots are never reinterpreted.
export function resolveLaborCalendar(mode: LaborCalculationInput["calendarMode"], now = new Date()) {
    if (mode === "excel_reference") {
        return { calendarMode: "excel_reference" as const, calendarYear: null, daysPerYear: reference.settings.daysPerYear }
    }
    const calendarYear = Number(businessDayKey(now).slice(0, 4))
    const daysPerYear = (Date.UTC(calendarYear + 1, 0, 1) - Date.UTC(calendarYear, 0, 1)) / 86_400_000
    return { calendarMode: "current_year" as const, calendarYear, daysPerYear }
}
