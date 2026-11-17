import { calculateLaborTemplate } from "./laborTemplateCalculation"
import { getLaborReference } from "./laborTemplateReference"
import { laborCalculationSchema } from "../schemas/laborTemplate.schema"

const reference = getLaborReference()
const example = () => ({ ...reference.settings, positions: structuredClone(reference.example.positions) })

test("reproduces EJEMPLO PLANTILLA B4:G55 without rounding the benefit percentage to 43.23", () => {
    const result = calculateLaborTemplate(example())
    expect(result.includedPositions).toBe(43)
    expect(result.salary.monthlyGtq).toBe(125641.7)
    expect(result.salary.annualGtq).toBe(1507700.4)
    expect(result.benefits.annualGtq).toBeCloseTo(651711.8740133345, 7)
    expect(result.bonus.annualGtq).toBe(129000)
    expect(result.total.hourlyGtq).toBeCloseTo(reference.example.expectedHourlyCostGtq, 8)
    expect(result.total.hourlyGtq.toFixed(4)).toBe("994.7147")
    expect(result.positions[0].benefitsMonthlyGtq).toBeCloseTo(1263.0075077777792, 9)
})

test("uses days / 7, then weekly hours; never divides by headcount", () => {
    const input = example()
    const original = calculateLaborTemplate(input)
    const doubledHours = calculateLaborTemplate({ ...input, weeklyHours: 88 })
    expect(doubledHours.total.hourlyGtq).toBeCloseTo(original.total.hourlyGtq / 2, 10)
    expect(calculateLaborTemplate({ ...input, daysPerYear: 364 }).total.hourlyGtq).not.toBeCloseTo(original.total.hourlyGtq, 2)
})

test("supports different salaries, fixed bonuses, selected benefits and both explicit bases", () => {
    const result = calculateLaborTemplate({ daysPerYear: 364, weeklyHours: 40,
        benefits: [{ code: "A", displayName: "A", percentage: 10, basis: "salary", isActive: true },
            { code: "B", displayName: "B", percentage: 5, basis: "salary_plus_bonus", isActive: true }],
        positions: [
            { code: "P1", jobTitle: "A", salaryMonthlyGtq: 3000, bonusMonthlyGtq: 250, applicableBenefitCodes: ["A", "B"], isActive: true },
            { code: "P2", jobTitle: "B", salaryMonthlyGtq: 4000, bonusMonthlyGtq: 500, applicableBenefitCodes: ["A"], isActive: true },
            { code: "P3", jobTitle: "C", salaryMonthlyGtq: 9000, bonusMonthlyGtq: 250, applicableBenefitCodes: [], isActive: false },
        ] })
    expect(result.salary.monthlyGtq).toBe(7000)
    expect(result.bonus.monthlyGtq).toBe(750)
    expect(result.benefits.monthlyGtq).toBe(862.5)
    expect(result.includedPositions).toBe(2)
    expect(result.total.hourlyGtq).toBeCloseTo(8612.5 * 12 / 52 / 40, 10)
})

test("one position, zero costs and no benefits are valid; zero hours and duplicate codes are not", () => {
    const input = { daysPerYear: 365, weeklyHours: 44, benefits: [], positions: [{ code: "ONE", jobTitle: "One", salaryMonthlyGtq: 0, bonusMonthlyGtq: 0, applicableBenefitCodes: [], isActive: true }] }
    expect(calculateLaborTemplate(input).total.hourlyGtq).toBe(0)
    for (const patch of [{ weeklyHours: 0 }, { daysPerYear: 0 }, { positions: [...input.positions, ...input.positions] },
        { positions: [{ ...input.positions[0], salaryMonthlyGtq: -1 }] }, { positions: [{ ...input.positions[0], salaryMonthlyGtq: 1.001 }] },
        { positions: [{ ...input.positions[0], applicableBenefitCodes: ["UNKNOWN"] }] }, { positions: [{ ...input.positions[0], isActive: false }] },
        { positions: [{ ...input.positions[0], salaryMonthlyGtq: null }] }]) {
        expect(laborCalculationSchema.safeParse({ ...input, ...patch }).success).toBe(false)
    }
})

test("changing an input does not mutate an earlier calculation or reference", () => {
    const input = example()
    const original = calculateLaborTemplate(input)
    input.positions[0].salaryMonthlyGtq = 4000
    expect(calculateLaborTemplate(input).total.hourlyGtq).toBeGreaterThan(original.total.hourlyGtq)
    expect(original.total.hourlyGtq.toFixed(4)).toBe("994.7147")
    expect(reference.example.positions[0].salaryMonthlyGtq).toBe(2921.9)
})
