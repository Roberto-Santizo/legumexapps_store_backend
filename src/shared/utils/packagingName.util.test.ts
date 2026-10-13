import Packaging from "../../features/packaging/models/Packaging.model"
import { packagingName, packagingNames } from "./packagingName.util"
import { buildUnitMaterialLine, buildIntermediateMaterialLine, buildPalletMaterialLine } from "../../features/quote/services/quoteCostLines"

it.each([null, undefined, "", "   "])("falls back without changing original catalog data: %s", displayNameEn => {
    const material = { displayName: "Original name", displayNameEn }
    expect(packagingName(material, "en-US")).toBe("Original name")
    expect(packagingName(material, "es-GT")).toBe("Original name")
    expect(packagingNames(material)).toEqual({ displayName: "Original name" })
})
it("keeps both stored names and never translates identifiers", () => {
    const material = { displayName: "Bolsa", displayNameEn: "Bag" }
    expect(packagingName(material, "en")).toBe("Bag")
    expect(packagingName(material, "es")).toBe("Bolsa")
    expect(packagingNames(material)).toEqual(material)
})
it.each([buildUnitMaterialLine, buildIntermediateMaterialLine, buildPalletMaterialLine])("bilingual snapshot metadata leaves every cost and quantity unchanged", build => {
    const material = { displayName: "Bolsa", code: "CODE-1", unitCost: 0.1234 } as Packaging
    const before = build(1, material, null, 4, 120)
    const after = build(1, { ...material, displayNameEn: "Bag" } as Packaging, null, 4, 120)
    const { displayNameEn, ...unchanged } = after
    expect(displayNameEn).toBe("Bag")
    expect(unchanged).toEqual(before)
})
