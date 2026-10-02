import { createProductSchema, updateProductSchema } from "./product.schema"

function validCreateInput() {
    return {

        subCategoryId: 1,
        clientId: 1,
        displayName: "Piña en Trozos",
    }
}

describe("createProductSchema", () => {
    it("acepta un input mínimo válido con clientId", () => {
        expect(createProductSchema.safeParse(validCreateInput()).success).toBe(true)
    })

    describe("clientId -- requerido (2026-09-16): cada Producto pertenece a exactamente un Cliente", () => {
        it("rechaza si falta clientId por completo", () => {
            const { clientId: _clientId, ...rest } = validCreateInput()
            expect(createProductSchema.safeParse(rest).success).toBe(false)
        })

        it("rechaza clientId: undefined explícito", () => {
            expect(createProductSchema.safeParse({ ...validCreateInput(), clientId: undefined }).success).toBe(false)
        })

        it("rechaza clientId = 0", () => {
            expect(createProductSchema.safeParse({ ...validCreateInput(), clientId: 0 }).success).toBe(false)
        })

        it("rechaza clientId negativo", () => {
            expect(createProductSchema.safeParse({ ...validCreateInput(), clientId: -1 }).success).toBe(false)
        })

        it("rechaza clientId decimal", () => {
            expect(createProductSchema.safeParse({ ...validCreateInput(), clientId: 1.5 }).success).toBe(false)
        })
    })
})

describe("updateProductSchema -- clientId recuperado como requerido dentro del .partial() (mismo criterio que codigo)", () => {
    it("rechaza un update que no manda clientId, aunque el resto de campos sean opcionales", () => {
        const result = updateProductSchema.safeParse({})
        expect(result.success).toBe(false)
    })

    it("acepta un update que sí manda clientId junto con codigo", () => {
        const result = updateProductSchema.safeParse({ clientId: 2 })
        expect(result.success).toBe(true)
    })

    it("rechaza clientId = 0 igual que en creación", () => {
        expect(updateProductSchema.safeParse({ clientId: 0 }).success).toBe(false)
    })
})
