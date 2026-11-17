import Decimal from "decimal.js"
import { laborCalculationSchema } from "../schemas/laborTemplate.schema"
import type { LaborCalculationInput } from "../schemas/laborTemplate.schema"

export const LABOR_FORMULA_VERSION = 1
const stored = (value: Decimal) => value.toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toNumber()

export function calculateLaborTemplate(input: LaborCalculationInput, calendarYear: number | null = null) {
    const data = laborCalculationSchema.parse(input)
    let salary = new Decimal(0)
    let benefits = new Decimal(0)
    let bonus = new Decimal(0)
    const positions = data.positions.map(position => {
        const positionSalary = new Decimal(position.salaryMonthlyGtq)
        const positionBonus = new Decimal(position.bonusMonthlyGtq)
        const positionBenefits = data.benefits.filter(benefit => benefit.isActive && position.applicableBenefitCodes.includes(benefit.code))
            .reduce((sum, benefit) => {
                const basis = benefit.basis === "salary_plus_bonus" ? positionSalary.plus(positionBonus) : positionSalary
                return sum.plus(basis.times(benefit.percentage).div(100))
            }, new Decimal(0))
        if (position.isActive) {
            salary = salary.plus(positionSalary)
            benefits = benefits.plus(positionBenefits)
            bonus = bonus.plus(positionBonus)
        }
        return { code: position.code, benefitsMonthlyGtq: stored(positionBenefits), totalMonthlyGtq: stored(positionSalary.plus(positionBenefits).plus(positionBonus)) }
    })
    const weeksPerYear = new Decimal(data.daysPerYear).div(7)
    const section = (monthly: Decimal) => {
        const annual = monthly.times(12)
        const weekly = annual.div(weeksPerYear)
        return { monthlyGtq: stored(monthly), annualGtq: stored(annual), weeklyGtq: stored(weekly), hourlyGtq: stored(weekly.div(data.weeklyHours)) }
    }
    return {
        formulaVersion: LABOR_FORMULA_VERSION,
        calendarYear,
        daysPerYear: data.daysPerYear,
        includedPositions: data.positions.filter(position => position.isActive).length,
        weeksPerYear: stored(weeksPerYear),
        salary: section(salary), benefits: section(benefits), bonus: section(bonus),
        total: section(salary.plus(benefits).plus(bonus)), positions,
    }
}

export type LaborCalculationResult = ReturnType<typeof calculateLaborTemplate>
