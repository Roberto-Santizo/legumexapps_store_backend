import z from "zod"
import { CUSTOM_QUOTE_PACKAGING_LEVELS, CUSTOM_QUOTE_QUANTITY_BASES } from "../constants/customQuoteConfig.constant"

// Listas de permitidos de "Cotizaciones a la medida". En los cuatro casos la fila apunta a UN
// elemento de catálogo (subcategoría + materia prima, ingrediente, presentación, empaque) que no
// cambia al editar: para ofrecer otro elemento se crea otra fila. Por eso los esquemas de update
// solo llevan los campos editables, y los que alimentan el cálculo son requeridos (§8: nada que
// afecte el costo queda opcional con un fallback silencioso).

export const customQuoteConfigIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const customQuoteConfigStatusSchema = z.object({
    isActive: z.boolean(),
})

const percentageSchema = z.number().min(0).max(100).multipleOf(0.01)

// ---- Materias primas por subcategoría ----
// min/max: null = sin límite (0 / 100). El chequeo min <= max vive en el servicio (clave i18n
// traducida), igual para crear y editar.
export const createCustomQuoteRawMaterialOptionSchema = z.object({
    subCategoryId: z.number().int().positive(),
    rawMaterialId: z.number().int().positive(),
    minPercentage: percentageSchema.nullable().default(null),
    maxPercentage: percentageSchema.nullable().default(null),
})

// Ambas claves requeridas (null = sin límite): un PATCH que omite una no la borra en silencio.
export const updateCustomQuoteRawMaterialOptionSchema = z.object({
    minPercentage: percentageSchema.nullable(),
    maxPercentage: percentageSchema.nullable(),
})

export const listCustomQuoteRawMaterialOptionsQuerySchema = z.object({
    subCategoryId: z.coerce.number().int().positive().optional(),
})

// ---- Ingredientes agregados (lista global) ----
// maxGramsPerKg: tope en gramos por kg de peso neto (vale para cualquier presentación).
const maxGramsPerKgSchema = z.number().positive().max(1000)

export const createCustomQuoteIngredientOptionSchema = z.object({
    ingredientId: z.number().int().positive(),
    maxGramsPerKg: maxGramsPerKgSchema.nullable().default(null),
})

export const updateCustomQuoteIngredientOptionSchema = z.object({
    maxGramsPerKg: maxGramsPerKgSchema.nullable(),
})

// ---- Presentaciones ofrecidas + composición de palet ----
const palletCountSchema = z.number().int().min(1)

export const createCustomQuotePresentationOptionSchema = z.object({
    presentationId: z.number().int().positive(),
    boxesPerPallet: palletCountSchema,
    bagsPerBox: palletCountSchema,
    // null = sin nivel intermedio para esta presentación.
    unitsPerIntermediatePackage: palletCountSchema.nullable().default(null),
})

export const updateCustomQuotePresentationOptionSchema = z.object({
    boxesPerPallet: palletCountSchema,
    bagsPerBox: palletCountSchema,
    unitsPerIntermediatePackage: palletCountSchema.nullable(),
})

// ---- Materiales de empaque (grupos de opciones globales por nivel) ----
// quantity/quantityBasis se validan contra el nivel del empaque en el servicio (el nivel sale del
// packagingRole, que el esquema no conoce). optionGroup/isDefault: mismo contrato que
// productVariantPalletMaterial.schema.ts (grupo null = fila fija).
const packagingOptionFields = {
    quantity: z.number().positive().nullable().default(null),
    quantityBasis: z.enum(CUSTOM_QUOTE_QUANTITY_BASES).nullable().default(null),
    optionGroup: z.string().trim().min(1).max(60).nullable().default(null),
    isDefault: z.boolean().default(false),
}

export const createCustomQuotePackagingOptionSchema = z.object({
    packagingId: z.number().int().positive(),
    ...packagingOptionFields,
})

// Mismo criterio que updateProductVariantPalletMaterialSchema: el formulario manda siempre todos
// los campos editables; uno omitido toma su valor por defecto (grupo omitido = fila fija).
export const updateCustomQuotePackagingOptionSchema = z.object(packagingOptionFields)

export const listCustomQuotePackagingOptionsQuerySchema = z.object({
    level: z.enum(CUSTOM_QUOTE_PACKAGING_LEVELS).optional(),
})

export type CreateCustomQuoteRawMaterialOptionInput = z.infer<typeof createCustomQuoteRawMaterialOptionSchema>
export type UpdateCustomQuoteRawMaterialOptionInput = z.infer<typeof updateCustomQuoteRawMaterialOptionSchema>
export type ListCustomQuoteRawMaterialOptionsQuery = z.infer<typeof listCustomQuoteRawMaterialOptionsQuerySchema>
export type CreateCustomQuoteIngredientOptionInput = z.infer<typeof createCustomQuoteIngredientOptionSchema>
export type UpdateCustomQuoteIngredientOptionInput = z.infer<typeof updateCustomQuoteIngredientOptionSchema>
export type CreateCustomQuotePresentationOptionInput = z.infer<typeof createCustomQuotePresentationOptionSchema>
export type UpdateCustomQuotePresentationOptionInput = z.infer<typeof updateCustomQuotePresentationOptionSchema>
export type CreateCustomQuotePackagingOptionInput = z.infer<typeof createCustomQuotePackagingOptionSchema>
export type UpdateCustomQuotePackagingOptionInput = z.infer<typeof updateCustomQuotePackagingOptionSchema>
export type ListCustomQuotePackagingOptionsQuery = z.infer<typeof listCustomQuotePackagingOptionsQuerySchema>
