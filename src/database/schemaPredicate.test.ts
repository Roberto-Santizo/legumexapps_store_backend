import { predicateContract } from "./schemaPredicate"
test("CHECK canonicalization preserves boolean grouping and case-sensitive literals", () => {
    expect(predicateContract("CHECK ((a IS NULL AND b IS NULL) OR (c='pallet'::text AND d > 0))"))
        .toBe(predicateContract("(a IS NULL AND b IS NULL) OR (c='pallet' AND (d > 0))"))
    expect(predicateContract("(a OR b) AND c")).not.toBe(predicateContract("a OR (b AND c)"))
    expect(predicateContract("c='generic'")).not.toBe(predicateContract("c='GENERIC'"))
    expect(predicateContract("c='AND OR' AND d>0")).toBe(predicateContract("(c='AND OR') AND (d>0)"))
})

test("CHECK canonicalization never hides casts that change numeric behavior", () => {
    expect(predicateContract('"costPerPound"::integer >= 0')).not.toBe(predicateContract('"costPerPound" >= 0'))
    expect(predicateContract('"costPerPound"::double precision >= 0')).not.toBe(predicateContract('"costPerPound" >= 0'))
    expect(predicateContract('"costPerPound" >= (0)::numeric')).toBe(predicateContract('"costPerPound" >= 0'))
})
