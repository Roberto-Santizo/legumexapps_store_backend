import { Op } from "sequelize"
import {
    BUSINESS_TIME_ZONE,
    businessDayEnd,
    businessDayRangeFilter,
    businessDayKey,
    businessDayStart,
    businessWeekKey,
    inclusiveDaySpan,
    isValidIsoDate,
} from "./businessTime.util"

describe("businessTime.util (America/Guatemala)", () => {
    it("el offset fijo UTC-6 coincide con Intl para America/Guatemala todo el año (sin horario de verano)", () => {
        const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
        for (const iso of ["2026-01-15T05:59:00Z", "2026-01-15T06:00:00Z", "2026-04-01T23:30:00Z", "2026-07-01T03:00:00Z", "2026-11-05T12:00:00Z"]) {
            const date = new Date(iso)
            expect(businessDayKey(date)).toBe(formatter.format(date))
        }
    })

    it("businessDayStart/End son 00:00 y 23:59:59.999 hora de Guatemala", () => {
        expect(businessDayStart("2026-01-10").toISOString()).toBe("2026-01-10T06:00:00.000Z")
        expect(businessDayEnd("2026-01-10").toISOString()).toBe("2026-01-11T05:59:59.999Z")
    })

    it("una cotización a las 20:00 locales cae en ese mismo día local, no en el día UTC siguiente", () => {
        // 2026-01-10 20:00 en Guatemala = 2026-01-11 02:00 UTC
        expect(businessDayKey(new Date("2026-01-11T02:00:00.000Z"))).toBe("2026-01-10")
    })

    it("businessWeekKey devuelve el lunes local, también para una noche de domingo", () => {
        // Domingo 2026-01-11 21:00 local (= lunes 03:00 UTC) pertenece a la semana del lunes 2026-01-05
        expect(businessWeekKey(new Date("2026-01-12T03:00:00.000Z"))).toBe("2026-01-05")
        // Lunes 2026-01-12 08:00 local
        expect(businessWeekKey(new Date("2026-01-12T14:00:00.000Z"))).toBe("2026-01-12")
    })

    it("isValidIsoDate acepta solo YYYY-MM-DD existentes", () => {
        expect(isValidIsoDate("2026-02-28")).toBe(true)
        expect(isValidIsoDate("2026-02-30")).toBe(false)
        expect(isValidIsoDate("2026-1-5")).toBe(false)
        expect(isValidIsoDate("2026-01-10T00:00:00Z")).toBe(false)
    })

    it("businessDayRangeFilter: undefined sin extremos, límites locales con uno o ambos", () => {
        expect(businessDayRangeFilter()).toBeUndefined()

        const both = businessDayRangeFilter("2026-01-10", "2026-01-11")!
        expect(both[Op.gte]).toEqual(new Date("2026-01-10T06:00:00.000Z"))
        expect(both[Op.lte]).toEqual(new Date("2026-01-12T05:59:59.999Z"))

        const onlyStart = businessDayRangeFilter("2026-01-10")!
        expect(onlyStart[Op.gte]).toEqual(new Date("2026-01-10T06:00:00.000Z"))
        expect(onlyStart[Op.lte]).toBeUndefined()

        const onlyEnd = businessDayRangeFilter(undefined, "2026-01-11")!
        expect(onlyEnd[Op.gte]).toBeUndefined()
        expect(onlyEnd[Op.lte]).toEqual(new Date("2026-01-12T05:59:59.999Z"))
    })

    it("inclusiveDaySpan cuenta ambos extremos", () => {
        expect(inclusiveDaySpan("2026-01-10", "2026-01-10")).toBe(1)
        expect(inclusiveDaySpan("2026-01-10", "2026-01-11")).toBe(2)
        expect(inclusiveDaySpan("2026-01-01", "2026-03-03")).toBe(62)
    })
})
