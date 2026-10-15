// Todos los importes se ingresan en USD (no hay monedas ni tipo de cambio); el resultado es USD por
// libra procesada.

// Categorías del desglose (encabezados del formulario y de los reportes).
export const TRANSFORMATION_COST_CATEGORIES = ["direct_labor", "packaging", "other"] as const
export type TransformationCostCategory = (typeof TRANSFORMATION_COST_CATEGORIES)[number]

// Base de cada costo adicional:
// - per_processed_pound: el importe ya es por libra procesada.
// - per_input_pound: el importe es por libra de entrada; se divide entre el rendimiento.
// - per_unit / per_batch: el importe es por unidad (bolsa, sticker...) o por lote; exige
//   poundsPerUnit = libras procesadas que cubre una unidad o un lote.
export const TRANSFORMATION_COST_BASES = ["per_processed_pound", "per_input_pound", "per_unit", "per_batch"] as const
export type TransformationCostBasis = (typeof TRANSFORMATION_COST_BASES)[number]
export const COST_BASES_REQUIRING_POUNDS: readonly TransformationCostBasis[] = ["per_unit", "per_batch"]

export const MAX_TRANSFORMATION_COST_LINES = 100

// Precisión con la que se guardan los importes de la transformación (columnas DECIMAL(24,12)).
// El catálogo de materias primas guarda costPerUnit con su escala propia (DECIMAL(10,4)) mediante
// roundMoney; el valor completo queda en la transformación.
export const TRANSFORMATION_STORAGE_DECIMALS = 12
