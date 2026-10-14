import { calculateQuoteSchema, salespersonQuoteSchema } from "./quote.schema"

test("mixed order identity requires a valid UUID and nonempty bounded customer name", () => {
    const input = { productVariantId: 10, requestedPallets: 1 }
    const order = { id: "5e226064-21be-4a9a-a5e5-f312391e363a", clientName: " Customer A " }
    expect(salespersonQuoteSchema.parse({ ...input, order }).order?.clientName).toBe("Customer A")
    for (const invalid of [{ ...order, id: "invalid" }, { ...order, clientName: " " }, { ...order, clientName: "x".repeat(151) }]) expect(salespersonQuoteSchema.safeParse({ ...input, order: invalid }).success).toBe(false)
})


function validInput() {
    return {
        productVariantId: 10,
        destinationId: 20,
        requestedPallets: 1,
    }
}

describe("calculateQuoteSchema", () => {
    it("acepta un input mínimo válido", () => {
        expect(calculateQuoteSchema.safeParse(validInput()).success).toBe(true)
    })

    it("descarta un rawMaterialMix enviado por el cliente: el producto de catálogo no acepta mezcla", () => {
        const result = calculateQuoteSchema.parse({
            ...validInput(),
            rawMaterialMix: [{ rawMaterialId: 1, percentage: 50 }, { rawMaterialId: 2, percentage: 50 }]
        })
        expect(result).not.toHaveProperty("rawMaterialMix")
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

        it("rechaza destinationId decimal (si se manda, sigue validado)", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), destinationId: 2.5 }).success).toBe(false)
        })

        it("rechaza destinationId <= 0 (si se manda, sigue validado)", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), destinationId: 0 }).success).toBe(false)
        })
    })

    describe("destinationId -- opcional (2026-09-10, transporte apagado: el cliente ya no elige destino)", () => {
        it("acepta el input sin destinationId en absoluto", () => {
            const { destinationId, ...rest } = validInput()
            const result = calculateQuoteSchema.safeParse(rest)
            expect(result.success).toBe(true)
            if (result.success) expect(result.data.destinationId).toBeUndefined()
        })

        it("acepta destinationId: undefined explícito", () => {
            expect(calculateQuoteSchema.safeParse({ ...validInput(), destinationId: undefined }).success).toBe(true)
        })
    })
})
