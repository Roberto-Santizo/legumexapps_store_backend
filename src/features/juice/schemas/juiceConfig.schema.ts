import { z } from "zod"
import { juiceIdParamSchema } from "./juice.schema"

const cost = z.number().nonnegative().max(9999999999.9999).multipleOf(0.0001)
// Fractional spreadsheet rates, NOT percentages entered as 2 / 10 / 6.5.
const rate = z.number().min(0).max(1).multipleOf(0.000001)
const count = z.number().int().positive().max(2147483647)

export const createJuiceCostConstantsSchema = z.strictObject({
    directLaborPerPound: cost,
    indirectLaborPerPound: cost,
    financialPerPound: cost,
    fixedPerPound: cost,
    electricityPerPound: cost,
    cleaningPerPound: cost,
    laboratoryPerPound: cost,
    hppPerPound: cost,
    palletizingPerContainer: cost,
    localCustomsPerContainer: cost,
    miamiCustomsPerContainer: cost,
    freightPerContainer: cost,
    inOutPerContainer: cost,
    accesorialPerContainer: cost,
    storagePerContainer: cost,
    logisticMovementPerContainer: cost,
    unexpectedRate: rate,
    tariffRate: rate,
    portFeeRate: rate,
    salesmanCommissionRate: rate,
    distributorCommissionRate: rate,
    palletsPerContainer: count,
})
// Replacing the singleton requires every costing field; never silently reset a rate to zero.
export const updateJuiceCostConstantsSchema = createJuiceCostConstantsSchema

export const createJuiceClientConstantOverrideSchema = z.strictObject({
    clientId: z.number().int().positive().max(2147483647),
    directLaborPerPound: createJuiceCostConstantsSchema.shape.directLaborPerPound.nullable().optional(),
    indirectLaborPerPound: createJuiceCostConstantsSchema.shape.indirectLaborPerPound.nullable().optional(),
    financialPerPound: createJuiceCostConstantsSchema.shape.financialPerPound.nullable().optional(),
    fixedPerPound: createJuiceCostConstantsSchema.shape.fixedPerPound.nullable().optional(),
    electricityPerPound: createJuiceCostConstantsSchema.shape.electricityPerPound.nullable().optional(),
    cleaningPerPound: createJuiceCostConstantsSchema.shape.cleaningPerPound.nullable().optional(),
    laboratoryPerPound: createJuiceCostConstantsSchema.shape.laboratoryPerPound.nullable().optional(),
    hppPerPound: createJuiceCostConstantsSchema.shape.hppPerPound.nullable().optional(),
    palletizingPerContainer: createJuiceCostConstantsSchema.shape.palletizingPerContainer.nullable().optional(),
    localCustomsPerContainer: createJuiceCostConstantsSchema.shape.localCustomsPerContainer.nullable().optional(),
    miamiCustomsPerContainer: createJuiceCostConstantsSchema.shape.miamiCustomsPerContainer.nullable().optional(),
    freightPerContainer: createJuiceCostConstantsSchema.shape.freightPerContainer.nullable().optional(),
    inOutPerContainer: createJuiceCostConstantsSchema.shape.inOutPerContainer.nullable().optional(),
    accesorialPerContainer: createJuiceCostConstantsSchema.shape.accesorialPerContainer.nullable().optional(),
    storagePerContainer: createJuiceCostConstantsSchema.shape.storagePerContainer.nullable().optional(),
    logisticMovementPerContainer: createJuiceCostConstantsSchema.shape.logisticMovementPerContainer.nullable().optional(),
    unexpectedRate: createJuiceCostConstantsSchema.shape.unexpectedRate.nullable().optional(),
    tariffRate: createJuiceCostConstantsSchema.shape.tariffRate.nullable().optional(),
    portFeeRate: createJuiceCostConstantsSchema.shape.portFeeRate.nullable().optional(),
    salesmanCommissionRate: createJuiceCostConstantsSchema.shape.salesmanCommissionRate.nullable().optional(),
    distributorCommissionRate: createJuiceCostConstantsSchema.shape.distributorCommissionRate.nullable().optional(),
    palletsPerContainer: createJuiceCostConstantsSchema.shape.palletsPerContainer.nullable().optional(),
})
// Omitted update fields stay untouched; null explicitly restores inheritance.
export const updateJuiceClientConstantOverrideSchema = createJuiceClientConstantOverrideSchema.omit({ clientId: true })
    .refine(value => Object.keys(value).length > 0, { message: "At least one override is required" })
export const juiceClientParamSchema = z.object({ clientId: juiceIdParamSchema.shape.id })
