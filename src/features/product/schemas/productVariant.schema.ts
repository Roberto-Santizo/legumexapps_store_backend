import z from "zod"

export const createProductVariantSchema = z.object({
    productId: z.number().int().positive(),
    presentationId: z.number().int().positive().optional(),
    intermediatePackagingId: z.number().int().positive().optional(),
    // Requerido (2026-09-13) -- mismo criterio que Product.codigo/Packaging.code/Ingredient.code:
    // es la clave que une el catálogo con los Excel de origen y con el autofill
    // (productVariantService.findVariantConfigBySkuCode). trim() para no aceptar puros espacios
    // como "válido" antes del chequeo de unicidad case-insensitive
    // (productVariant.service.ts::assertSkuCodeIsUnique).
    skuCode: z.string().trim().min(1).max(60),
    // "Palet" (2026-09-12): reemplaza el viejo unitsPerPallet manual -- ambos son REQUERIDOS
    // (sin fallback silencioso), porque quoteService.calculateQuote deriva
    // bagsPerPallet = boxesPerPallet * bagsPerBox y lo usa para TODO el cálculo (mismo criterio
    // que el resto de campos que alimentan el motor de cotización, ver memoria del proyecto).
    boxesPerPallet: z.number().int().positive(),
    bagsPerBox: z.number().int().positive(),
    unitsPerIntermediatePackage: z.number().int().positive().optional(),
})

export const productVariantIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const productVariantSkuCodeParamSchema = z.object({
    skuCode: z.string().trim().min(1).max(60),
})

// skuCode/boxesPerPallet/bagsPerBox se recuperan como requeridos dentro del partial -- mismo
// patrón que el resto de campos críticos del motor de cálculo (ver
// ProductVariantPalletMaterial.quantityValue, Ingredient.costPerUnit, etc. en memoria del
// proyecto): updateSchema = createSchema.partial() vuelve opcional TODO por defecto, así que un
// campo que nunca puede quedar vacío ni al editar se "recupera" explícito acá.
export const updateProductVariantSchema = createProductVariantSchema.partial().extend({
    skuCode: createProductVariantSchema.shape.skuCode,
    boxesPerPallet: createProductVariantSchema.shape.boxesPerPallet,
    bagsPerBox: createProductVariantSchema.shape.bagsPerBox,
})

const skuLookupMaterialSchema = z.object({
    packagingId: z.number().int(),
    displayName: z.string(),
    quantity: z.number(),
})

// Forma de respuesta del autofill (productVariantService.findVariantConfigBySkuCode) -- NO es
// ProductVariantResponse: es una vista de solo lectura pensada para prellenar el form de creación/
// edición de variante (presentación + palet) más una vista de referencia de la receta de empaque
// ya cargada para ese SKU (unitMaterials/palletMaterials), que el admin debe volver a agregar a
// mano en sus propias secciones una vez guardada la variante -- ver
// productVariantSection.component.tsx. Nunca se usa para escribir nada directo.
export const productVariantSkuLookupSchema = z.object({
    skuCode: z.string(),
    productId: z.number().int(),
    productDisplayName: z.string(),
    presentationId: z.number().int().nullable(),
    presentationLabel: z.string().nullable(),
    boxesPerPallet: z.number().int().nullable(),
    bagsPerBox: z.number().int().nullable(),
    intermediatePackagingId: z.number().int().nullable(),
    unitsPerIntermediatePackage: z.number().int().nullable(),
    unitMaterials: z.array(skuLookupMaterialSchema),
    palletMaterials: z.array(skuLookupMaterialSchema),
})

export type CreateProductVariantInput = z.infer<typeof createProductVariantSchema>
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>
export type ProductVariantSkuLookup = z.infer<typeof productVariantSkuLookupSchema>
