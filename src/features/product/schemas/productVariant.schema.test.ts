import { createProductVariantSchema, updateProductVariantSchema } from "./productVariant.schema"

function validCreateInput() {
    return {
        skuCode: "SKU-001",
    productId: 1,
        presentationId: 3,
        boxesPerPallet: 20,
        bagsPerBox: 6,
    }
}

describe("createProductVariantSchema", () => {
    it("acepta un input mínimo válido con presentationId", () => {
        expect(createProductVariantSchema.safeParse(validCreateInput()).success).toBe(true)
    })

    describe("presentationId -- requerido (2026-09-16): cada SKU es, por definición, un producto en UNA presentación", () => {
        it("rechaza si falta presentationId por completo", () => {
            const { presentationId: _presentationId, ...rest } = validCreateInput()
            expect(createProductVariantSchema.safeParse(rest).success).toBe(false)
        })

        it("rechaza presentationId: undefined explícito", () => {
            expect(createProductVariantSchema.safeParse({ ...validCreateInput(), presentationId: undefined }).success).toBe(false)
        })

        it("rechaza presentationId = 0", () => {
            expect(createProductVariantSchema.safeParse({ ...validCreateInput(), presentationId: 0 }).success).toBe(false)
        })

        it("rechaza presentationId negativo", () => {
            expect(createProductVariantSchema.safeParse({ ...validCreateInput(), presentationId: -1 }).success).toBe(false)
        })

        it("rechaza presentationId decimal", () => {
            expect(createProductVariantSchema.safeParse({ ...validCreateInput(), presentationId: 1.5 }).success).toBe(false)
        })
    })
})

describe("updateProductVariantSchema -- presentationId recuperado como requerido dentro del .partial() (mismo criterio que boxesPerPallet/bagsPerBox)", () => {
    it("rechaza un update que no manda presentationId, aunque el resto de campos requeridos sí vengan", () => {
        const result = updateProductVariantSchema.safeParse({ skuCode: "SKU-001", boxesPerPallet: 20, bagsPerBox: 6 })
        expect(result.success).toBe(false)
    })

    it("acepta un update que sí manda presentationId junto con el resto de campos requeridos", () => {
        const result = updateProductVariantSchema.safeParse({ skuCode: "SKU-001", boxesPerPallet: 20, bagsPerBox: 6, presentationId: 3 })
        expect(result.success).toBe(true)
    })

    it("rechaza presentationId = 0 igual que en creación", () => {
        expect(
            updateProductVariantSchema.safeParse({ skuCode: "SKU-001", boxesPerPallet: 20, bagsPerBox: 6, presentationId: 0 }).success
        ).toBe(false)
    })
})

describe("skuCode requerido", () => {
    it.each([undefined, "", "   ", "x".repeat(61)])("rechaza SKU inválido %s en create/update", skuCode => {
        const input = { ...validCreateInput(), skuCode }
        expect(createProductVariantSchema.safeParse(input).success).toBe(false)
        expect(updateProductVariantSchema.safeParse(input).success).toBe(false)
    })
    it("recorta espacios sin cambiar el SKU visible", () => {
        expect(createProductVariantSchema.parse({ ...validCreateInput(), skuCode: "  Ab-001  " }).skuCode).toBe("Ab-001")
    })
})
