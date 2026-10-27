import { validateGenericProfile, resolveGenericPackaging, type GenericProfile } from "./genericPackagingResolver";
const fixture = (): GenericProfile => ({ id: 1, reference: "G1", displayName: "Profile", categoryId: 1, presentationId: 1, bagsPerBox: 5, boxesPerPallet: 60, unitsPerIntermediatePackage: null, isActive: true,
    presentation: { displayLabel: "16 oz", netWeightGrams: 454, isActive: true }, groups: [{ id: 1, packagingGroupId: 1, level: "pallet", selectionMode: "one", isRequired: true, isActive: true, group: { displayName: "Cajas", isActive: true }, options: [{ id: 10, packagingId: 10, quantityBasis: "per_box", quantityValue: 1, isActive: true, packaging: { displayName: "Box", classification: "generic", packagingRole: "pallet", unitCost: "0.123456789123", isActive: true } }] }] });
it("requires explicit request even for a single alternative", () => { expect(() => resolveGenericPackaging(fixture(), [])).toThrow(); expect(resolveGenericPackaging(fixture(), [{ groupId: 1, optionIds: [10] }])).toHaveLength(1); });
it.each(["Bolsas", "Cajas", "Esquineros"])("blocks missing mandatory %s", name => { const p = fixture(); p.groups[0].group.displayName = name; expect(() => resolveGenericPackaging(p, [])).toThrow(); });
it("includes all mandatory cumulative options without any frontend selections", () => { const p = fixture(); p.groups[0].selectionMode = "all"; p.groups[0].options.push({ ...p.groups[0].options[0], id: 11, packagingId: 11, quantityValue: 93.3 }); expect(resolveGenericPackaging(p, []).map(row => row.option.quantityValue)).toEqual([1, 93.3]); expect(() => resolveGenericPackaging(p, [{ groupId: 1, optionIds: [10] }])).toThrow(); });
it("empty required group blocks, optional empty group does not", () => { const p = fixture(); p.groups[0].options = []; expect(() => resolveGenericPackaging(p, [])).toThrow(); p.groups[0].isRequired = false; expect(resolveGenericPackaging(p, [])).toEqual([]); });
it("optional groups cost nothing unless explicitly selected", () => { const p = fixture(); p.groups[0].isRequired = false; expect(resolveGenericPackaging(p, [])).toEqual([]); expect(resolveGenericPackaging(p, [{ groupId: 1, optionIds: [10] }])).toHaveLength(1); });
it.each(["specific", "inactive", "missingCost", "negativeCost", "quantity", "basis"])("rejects %s", mode => { const p = fixture(), o = p.groups[0].options[0]; if (mode === "specific")
    o.packaging.classification = "specific"; if (mode === "inactive")
    o.packaging.isActive = false; if (mode === "missingCost")
    o.packaging.unitCost = null; if (mode === "negativeCost")
    o.packaging.unitCost = -1; if (mode === "quantity")
    o.quantityValue = 0; if (mode === "basis")
    o.quantityBasis = "per_unit"; expect(() => resolveGenericPackaging(p, [{ groupId: 1, optionIds: [10] }])).toThrow(); });
it("rejects duplicates, foreign and manipulated selections", () => { const p = fixture(); for (const s of [[{ groupId: 1, optionIds: [10, 10] }], [{ groupId: 9, optionIds: [10] }], [{ groupId: 1, optionIds: [99] }], [{ groupId: 1, optionIds: [10] }, { groupId: 1, optionIds: [10] }]])
    expect(() => resolveGenericPackaging(p, s)).toThrow(); });
it("mandatory cumulative unavailable material blocks instead of disappearing", () => { const p = fixture(); p.groups[0].selectionMode = "all"; p.groups[0].options[0].packaging.isActive = false; expect(() => resolveGenericPackaging(p, [])).toThrow(); });

it("duplicate materials across groups cannot be published as a ready configuration", () => { const profile=fixture(); profile.groups.push({...profile.groups[0],id:2,packagingGroupId:2,options:profile.groups[0].options.map(option=>({...option,id:20}))}); expect(()=>validateGenericProfile(profile)).toThrow(); });

it("B1 exposes no partial choices for unavailable optional cumulative groups", () => {
 const { genericConfigurationOption } = require("./genericQuoteAdapter");
 const p = fixture(); p.groups[0].selectionMode = "all"; p.groups[0].isRequired = false;
 p.groups[0].options.push({...p.groups[0].options[0], id: 11, packagingId: 11, packaging: {...p.groups[0].options[0].packaging, isActive: false}});
 expect(genericConfigurationOption(p).packaging.pallet.groups[0].options).toEqual([]);
 expect(resolveGenericPackaging(p, [])).toEqual([]);
 expect(() => resolveGenericPackaging(p, [{groupId: 1, optionIds: [10]}])).toThrow();
});
