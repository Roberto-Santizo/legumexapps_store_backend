import { calculateQuoteSchema } from "./quote.schema"


function validInput() {
    return {
        productVariantId: 10,
        destinationId: 20,
        requestedPallets: 1,
    }
}

describe("calculateQuoteSchema", () => {
    it("acepta un input mínimo válido sin mix (producto de receta fija)", () => {
        expect(calculateQuoteSchema.safeParse(validInput()).success).toBe(true)
    })

    it("acepta un input válido con mix de ingredientes", () => {
        const result = calculateQuoteSchema.safeParse({
            ...validInput(),
            ingredientMix: [{ ingredientId: 1, percentage: 50 }, { ingredientId: 2, percentage: 50 }]
        })
        expect(result.success).toBe(true)
    })

    describe("requestedPallets -- mínimo 1 palet completo, nunca fracciones (decisión de negocio)", () => {
        it("rechaza 0 palets", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), requestedPallets: 0 }).success).toBe(false)
        })

        it("rechaza palets negativos", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), requestedPallets: -1 }).success).toBe(false)
        })

        it("rechaza palets fraccionarios (ej. 1.5) -- el negocio exige palet completo", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), requestedPallets: 1.5 }).success).toBe(false)
        })

        it("acepta exactamente 1 palet (el mínimo permitido)", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), requestedPallets: 1 }).success).toBe(true)
        })
    })

    describe("productVariantId / destinationId -- deben ser ids reales, no 0/negativos/decimales", () => {
        it("rechaza productVariantId = 0", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), productVariantId: 0 }).success).toBe(false)
        })

        it("rechaza productVariantId negativo", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), productVariantId: -5 }).success).toBe(false)
        })

        it("rechaza destinationId decimal", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), destinationId: 2.5 }).success).toBe(false)
        })
    })

    describe("ingredientMix[].percentage -- tope a 2 decimales para no inflar precisión falsa (33.333... de dividir 100/3)", () => {
        it("rechaza un porcentaje con más de 2 decimales", () => {
            const result = calculateQuoteSchema.safeParse({
                ...validInput(),
                ingredientMix: [{ ingredientId: 1, percentage: 33.333 }]
            })
            expect(result.success).toBe(false)
        })

        it("acepta un porcentaje con exactamente 2 decimales", () => {
            const result = calculateQuoteSchema.safeParse({
                ...validInput(),
                ingredientMix: [{ ingredientId: 1, percentage: 33.33 }]
            })
            expect(result.success).toBe(true)
        })

        it("rechaza un porcentaje negativo", () => {
            const result = calculateQuoteSchema.safeParse({
                ...validInput(),
                ingredientMix: [{ ingredientId: 1, percentage: -10 }]
            })
            expect(result.success).toBe(false)
        })

        it("rechaza un porcentaje por encima de 100", () => {
            const result = calculateQuoteSchema.safeParse({
                ...validInput(),
                ingredientMix: [{ ingredientId: 1, percentage: 100.01 }]
            })
            expect(result.success).toBe(false)
        })

        it("acepta 0 y 100 como bordes válidos", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), ingredientMix: [{ ingredientId: 1, percentage: 0 }] }).success).toBe(true)
            expect(calculateQuoteSchema.safeParse({ ...validInput(), ingredientMix: [{ ingredientId: 1, percentage: 100 }] }).success).toBe(true)
        })

        it("rechaza ingredientId no positivo dentro del mix", () => {
            const result = calculateQuoteSchema.safeParse({
                ...validInput(),
                ingredientMix: [{ ingredientId: 0, percentage: 100 }]
            })
            expect(result.success).toBe(false)
        })
    })

    it("ingredientMix es opcional -- un producto de receta fija no lo manda", () => {
        const { ingredientMix, ...rest } = validInput() as ReturnType<typeof validInput> & { ingredientMix?: unknown }
        expect(calculateQuoteSchema.safeParse(rest).success).toBe(true)
        expect(ingredientMix).toBeUndefined()
    })
})
