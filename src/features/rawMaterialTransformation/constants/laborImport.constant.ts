import type { LaborCalculationInput, SaveLaborLineInput } from "../schemas/laborTemplate.schema"

export type LaborImportLine = Omit<SaveLaborLineInput, "expectedVersion"> & { revision: number }
export type LaborImportSettings = Pick<LaborCalculationInput, "weeklyHours" | "benefits">

export const LABOR_IMPORT_FILENAME = "plantilla-rrhh-sueldos.xlsx"
export const LABOR_IMPORT_SHEET = "Sueldos"
export const LABOR_IMPORT_COLUMNS = ["NO. POSICION", "PLANTILLA", "PUESTO", "Salario Mensual", "Bono Decreto"] as const
export const LABOR_IMPORT_MAX_ROWS = 10000
