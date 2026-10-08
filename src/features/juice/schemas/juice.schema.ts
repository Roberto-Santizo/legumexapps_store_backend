import { z } from "zod"

const id = z.number().int().positive().max(2147483647)
const money = z.number().nonnegative().max(9999999999.9999).multipleOf(0.0001)
const preciseCost = z.number().nonnegative().max(99999999.999999).multipleOf(0.000001)
// Source costs/PRICE LB retain spreadsheet precision; quote amounts still round to 4 places.
const sourceCost = z.number().nonnegative().max(9999999999.9999).multipleOf(0.000000000001)
const name = z.string().trim().min(1).max(120)
const code = z.string().trim().min(1).max(60)

export const juiceIdParamSchema = z.object({ id: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(id) })
export const juiceStatusSchema = z.strictObject({ isActive: z.boolean() })
export const juiceListQuerySchema = z.strictObject({ juiceId: z.coerce.number().pipe(id).optional() })

export const createJuiceRawMaterialSchema = z.strictObject({
    code,
    displayName: name,
    purchaseUnit: z.enum(["LIBRA", "LITRO", "GRAMO"]),
    yieldPoundsPerLiter: preciseCost.positive(),
    costPerUnit: sourceCost,
})
export const updateJuiceRawMaterialSchema = createJuiceRawMaterialSchema

export const createJuiceSchema = z.strictObject({
    code,
    displayName: name,
    clientId: id,
    pricePerPound: sourceCost.positive(),
    image: z.string().nullable().optional(),
})
export const updateJuiceSchema = createJuiceSchema

export const createJuicePresentationSchema = z.strictObject({
    juiceId: id,
    displayLabel: name,
    mlPerBottle: z.number().positive().max(99999999999.999).multipleOf(0.001),
    bottlesPerCase: id,
    casesPerPallet: id,
    boxUnitCost: sourceCost,
    stickerUnitCost: sourceCost,
    stickerQuantityPerCase: preciseCost,
    secondStickerUnitCost: sourceCost,
    secondStickerQuantityPerCase: preciseCost,
    bottleUnitCost: sourceCost,
    capUnitCost: sourceCost,
    marginPerCase: money,
})
export const updateJuicePresentationSchema = createJuicePresentationSchema.omit({ juiceId: true })

export const createJuiceMixSchema = z.strictObject({
    juiceId: id,
    rawMaterialId: id,
    percentage: z.number().positive().max(100).multipleOf(0.000001),
})
export const updateJuiceMixSchema = createJuiceMixSchema.pick({ percentage: true })

export const createJuiceSpiceMaterialSchema = z.strictObject({ code, displayName: name, costPerGram: sourceCost })
export const updateJuiceSpiceMaterialSchema = createJuiceSpiceMaterialSchema
export const createJuiceSpiceSchema = z.strictObject({ juiceId: id, spiceMaterialId: id, gramsPerLiter: preciseCost.positive() })
export const updateJuiceSpiceSchema = createJuiceSpiceSchema.pick({ gramsPerLiter: true })
