import z from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

const code = z.string().trim().toUpperCase().min(1).max(60).regex(/^[A-Z0-9_-]+$/)
const name = z.string().trim().min(1).max(160)
const amount = z.number().finite().nonnegative().max(1_000_000).multipleOf(0.01)

export const laborBenefitSchema = z.strictObject({
    code,
    displayName: name,
    percentage: z.number().finite().min(0).max(100),
    basis: z.enum(["salary", "salary_plus_bonus"]),
    isActive: z.boolean(),
})

export const laborLinePositionSchema = z.strictObject({ code, jobTitle: name })
export const saveLaborLineSchema = z.strictObject({
    code,
    displayName: name,
    plantName: name,
    shift: z.enum(["AM", "PM"]),
    isActive: z.boolean(),
    positions: z.array(laborLinePositionSchema).min(1).max(500),
    expectedVersion: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
    const codes = new Set<string>()
    value.positions.forEach((position, index) => {
        if (codes.has(position.code)) ctx.addIssue({ code: "custom", path: ["positions", index, "code"], message: "Duplicate code" })
        codes.add(position.code)
    })
})

export const laborTemplatePositionSchema = laborLinePositionSchema.extend({
    salaryMonthlyGtq: amount,
    bonusMonthlyGtq: amount,
    isActive: z.boolean(),
    applicableBenefitCodes: z.array(code).max(20),
})

export const laborCalculationSchema = z.strictObject({
    calendarMode: z.enum(["current_year", "excel_reference"]).optional(),
    daysPerYear: z.number().int().min(1).max(366),
    weeklyHours: z.number().finite().positive().max(168).multipleOf(0.0001),
    benefits: z.array(laborBenefitSchema).max(20),
    positions: z.array(laborTemplatePositionSchema).min(1).max(500),
}).superRefine((value, ctx) => {
    const benefitCodes = new Set<string>()
    value.benefits.forEach((benefit, index) => {
        if (benefitCodes.has(benefit.code)) ctx.addIssue({ code: "custom", path: ["benefits", index, "code"], message: "Duplicate code" })
        benefitCodes.add(benefit.code)
    })
    const positionCodes = new Set<string>()
    value.positions.forEach((position, index) => {
        if (positionCodes.has(position.code)) ctx.addIssue({ code: "custom", path: ["positions", index, "code"], message: "Duplicate code" })
        positionCodes.add(position.code)
        if (new Set(position.applicableBenefitCodes).size !== position.applicableBenefitCodes.length || position.applicableBenefitCodes.some(item => !benefitCodes.has(item))) {
            ctx.addIssue({ code: "custom", path: ["positions", index, "applicableBenefitCodes"], message: "Invalid benefits" })
        }
    })
    if (!value.positions.some(position => position.isActive)) ctx.addIssue({ code: "custom", path: ["positions"], message: "At least one included position is required" })
})

export const saveLaborTemplateSchema = laborCalculationSchema.safeExtend({
    code,
    displayName: name,
    lineCode: code,
    isActive: z.boolean(),
    effectiveFrom: z.iso.date(),
    changeReason: z.string().trim().min(3).max(500),
    expectedVersion: z.number().int().nonnegative(),
})

export const laborTemplateIdSchema = z.object({ id: z.string().regex(/^[1-9]\d*$/).max(10) })
export const laborRevisionParamSchema = laborTemplateIdSchema.extend({ revision: z.string().regex(/^[1-9]\d*$/).max(10) })
export const laborLineCodeSchema = z.object({ code })
export const laborTemplateQuerySchema = paginationQuerySchema.extend({ search: z.string().trim().max(160).optional() })

export type LaborCalculationInput = z.infer<typeof laborCalculationSchema>
export type SaveLaborTemplateInput = z.infer<typeof saveLaborTemplateSchema>
export type SaveLaborLineInput = z.infer<typeof saveLaborLineSchema>
export type LaborBenefit = z.infer<typeof laborBenefitSchema>
export type LaborLinePosition = z.infer<typeof laborLinePositionSchema>
