import { bucketMaterialsByGroup, resolveMaterialsForQuote } from "./quoteMaterialSelection"

describe("catalog group identity", () => {
    it("keeps alternatives together across a rename and resolves the selected row", () => {
        const rows = [{ id: 1, optionGroupId: 4, optionGroup: "Caja", isDefault: true }, { id: 2, optionGroupId: 4, optionGroup: "Caja exterior", isDefault: false }]
        expect(bucketMaterialsByGroup(rows).groups.size).toBe(1)
        expect(resolveMaterialsForQuote(rows, [2], "unit")).toEqual([rows[1]])
        expect(() => resolveMaterialsForQuote(rows, [1, 2], "unit")).toThrow()
    })
    it("does not merge different IDs with the same label", () => {
        const rows = [{ id: 1, optionGroupId: 4, optionGroup: "Caja", isDefault: true }, { id: 2, optionGroupId: 5, optionGroup: "Caja", isDefault: true }]
        expect(resolveMaterialsForQuote(rows, [], "unit")).toHaveLength(2)
    })
    it("keeps legacy intermediate, pallet and custom quote grouping unchanged", () => {
        const rows = [{ id: 1, optionGroup: "Caja", isDefault: true }, { id: 2, optionGroup: " CAJA ", isDefault: false }]
        expect(resolveMaterialsForQuote(rows, [], "pallet")).toEqual([rows[0]])
    })
})
