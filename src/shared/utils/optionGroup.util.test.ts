import { isSameOptionGroup, normalizeOptionGroup, optionGroupKey, resolveOptionGroupSpelling } from "./optionGroup.util"

describe("optionGroup.util", () => {
    it("normaliza: recorta y colapsa espacios; vacío/null → null (fila fija)", () => {
        expect(normalizeOptionGroup("  Caja   de  envío ")).toBe("Caja de envío")
        expect(normalizeOptionGroup("   ")).toBeNull()
        expect(normalizeOptionGroup(null)).toBeNull()
        expect(normalizeOptionGroup(undefined)).toBeNull()
    })

    it("la clave ignora mayúsculas y espacios", () => {
        expect(optionGroupKey(" CAJA ")).toBe("caja")
        expect(optionGroupKey(null)).toBeNull()
    })

    it("isSameOptionGroup compara sin mayúsculas/espacios y nunca iguala dos filas fijas", () => {
        expect(isSameOptionGroup("Caja", "  caja")).toBe(true)
        expect(isSameOptionGroup("Caja", "Esquinero")).toBe(false)
        expect(isSameOptionGroup(null, null)).toBe(false)
    })

    it("reutiliza la grafía de un grupo existente, o devuelve el nombre normalizado si es nuevo", () => {
        expect(resolveOptionGroupSpelling("caja ", ["Esquinero", "Caja"])).toBe("Caja")
        expect(resolveOptionGroupSpelling("Bolsa  con logo", ["Caja", null])).toBe("Bolsa con logo")
        expect(resolveOptionGroupSpelling(null, ["Caja"])).toBeNull()
    })
})
