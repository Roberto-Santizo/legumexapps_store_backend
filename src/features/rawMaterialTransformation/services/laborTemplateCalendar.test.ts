import { resolveLaborCalendar } from "./laborTemplateCalendar"

test.each([[2026, 365], [2028, 366], [2000, 366], [2100, 365]])("uses the actual calendar length of %i", (year, days) => {
    expect(resolveLaborCalendar("current_year", new Date(`${year}-07-01T12:00:00Z`))).toEqual({ calendarMode: "current_year", calendarYear: year, daysPerYear: days })
})

test("rolls over at midnight in Guatemala, not at midnight UTC", () => {
    expect(resolveLaborCalendar(undefined, new Date("2028-01-01T05:59:59Z"))).toMatchObject({ calendarYear: 2027, daysPerYear: 365 })
    expect(resolveLaborCalendar(undefined, new Date("2028-01-01T06:00:00Z"))).toMatchObject({ calendarYear: 2028, daysPerYear: 366 })
})

test("keeps the explicit Excel reference unchanged in every calendar year", () => {
    expect(resolveLaborCalendar("excel_reference", new Date("2026-07-01T12:00:00Z"))).toEqual({ calendarMode: "excel_reference", calendarYear: null, daysPerYear: 366 })
})
