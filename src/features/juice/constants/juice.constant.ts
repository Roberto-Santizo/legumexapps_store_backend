// Spreadsheet conversion constants: intentionally separate from the product weight engine.
export const JUICE_POUNDS_PER_LITER = "2.2046"
export const JUICE_PACKAGING_RECOVERY_FACTOR = "0.97"

// Rates are fractions: 0.02 = 2%, 0.00125 = 0.125%. Costs are nonnegative input magnitudes; the
// calculation applies the spreadsheet signs.
export const JUICE_CONSTANT_FIELDS = [
    "directLaborPerPound",
    "indirectLaborPerPound",
    "financialPerPound",
    "fixedPerPound",
    "electricityPerPound",
    "cleaningPerPound",
    "laboratoryPerPound",
    "hppPerPound",
    "palletizingPerContainer",
    "localCustomsPerContainer",
    "miamiCustomsPerContainer",
    "freightPerContainer",
    "inOutPerContainer",
    "accesorialPerContainer",
    "storagePerContainer",
    "logisticMovementPerContainer",
    "unexpectedRate",
    "tariffRate",
    "portFeeRate",
    "salesmanCommissionRate",
    "distributorCommissionRate",
    "palletsPerContainer",
] as const
export type JuiceConstantField = typeof JUICE_CONSTANT_FIELDS[number]
export type JuiceConstantsValues = Record<JuiceConstantField, number>
