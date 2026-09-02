import { slugify, generateUniqueSlug } from "./slug.util"

describe("slugify", () => {
    it("pasa a minúsculas y reemplaza espacios por guiones", () => {
        expect(slugify("Piña en Trozos")).toBe("pina-en-trozos")
    })

    it("quita acentos y diacríticos", () => {
        expect(slugify("Cátsup Jalapeño")).toBe("catsup-jalapeno")
    })

    it("colapsa símbolos y espacios repetidos en un solo guion", () => {
        expect(slugify("Caja  Corrugada / Master #1")).toBe("caja-corrugada-master-1")
    })

    it("recorta guiones al inicio y al final", () => {
        expect(slugify("  --Bolsa 2kg--  ")).toBe("bolsa-2kg")
    })

    it("produce string vacío si no queda ningún caracter válido", () => {
        expect(slugify("¡¡¡ !!!")).toBe("")
    })
})

describe("generateUniqueSlug", () => {
    it("devuelve el slug base si está libre", async () => {
        const isTaken = jest.fn().mockResolvedValue(false)

        const slug = await generateUniqueSlug("Piña Orgánica", isTaken)

        expect(slug).toBe("pina-organica")
        expect(isTaken).toHaveBeenCalledWith("pina-organica")
    })

    it("agrega sufijo -2, -3... hasta encontrar uno libre", async () => {
        const taken = new Set(["pina", "pina-2", "pina-3"])
        const isTaken = jest.fn(async (candidate: string) => taken.has(candidate))

        const slug = await generateUniqueSlug("Piña", isTaken)

        expect(slug).toBe("pina-4")
        expect(isTaken).toHaveBeenCalledTimes(4)
    })

    it("usa 'item' como base si el texto no deja ningún caracter válido", async () => {
        const isTaken = jest.fn().mockResolvedValue(false)

        const slug = await generateUniqueSlug("###", isTaken)

        expect(slug).toBe("item")
    })
})
