import { assertTableConstraintInventory } from "./schemaReadiness"

const table = "genericPackagingConfigurations"
const primaryKey = {
    name: `${table}_pkey`, kind: "p", validated: true, enforced: true,
    deferrable: false, deferred: false, no_inherit: true, keys: ["id"],
}
const check = { ...primaryKey, name: "gpc_boxes_per_pallet_check", kind: "c", no_inherit: false, keys: ["boxesPerPallet"] }
const expectedNames = [primaryKey.name, check.name]
const requiredFields = ["id", "boxesPerPallet"]
const notNull = (field: string) => ({ ...primaryKey, name: `${table}_${field}_not_null`, kind: "n", no_inherit: false, keys: [field] })

test("accepts PostgreSQL 15–17 constraint inventories after column nullability was verified", () => {
    expect(() => assertTableConstraintInventory(table, [primaryKey, check], expectedNames, requiredFields)).not.toThrow()
})

test("accepts PostgreSQL 18 NOT NULL catalog entries without counting them as additional named constraints", () => {
    expect(() => assertTableConstraintInventory(table,
        [primaryKey, check, ...requiredFields.map(notNull)], expectedNames, requiredFields)).not.toThrow()
})

test.each([
    ["unvalidated", { validated: false }],
    ["not enforced", { enforced: false }],
    ["deferrable", { deferrable: true }],
    ["deferred", { deferred: true }],
    ["non-inheritable", { no_inherit: true }],
    ["nullable column", { keys: ["unitsPerIntermediatePackage"] }],
    ["several columns", { keys: ["id", "boxesPerPallet"] }],
    ["no columns", { keys: [] }],
])("rejects a %s NOT NULL constraint", (_name, changes) => {
    const constraints = [primaryKey, check, notNull("id"), { ...notNull("boxesPerPallet"), ...changes }]
    expect(() => assertTableConstraintInventory(table, constraints, expectedNames, requiredFields))
        .toThrow(`NOT NULL constraint mismatch ${table}`)
})

test("rejects duplicate or incomplete PostgreSQL 18 NOT NULL inventories", () => {
    for (const constraints of [[notNull("id")], [notNull("id"), notNull("id")]]) {
        expect(() => assertTableConstraintInventory(table, [primaryKey, check, ...constraints], expectedNames, requiredFields))
            .toThrow(`NOT NULL constraint mismatch ${table}`)
    }
})

test.each([
    ["unexpected CHECK", [primaryKey, check, { ...check, name: "unauthorized_check" }]],
    ["missing CHECK", [primaryKey]],
    ["renamed CHECK", [primaryKey, { ...check, name: "renamed_check" }]],
    ["unvalidated CHECK", [primaryKey, { ...check, validated: false }]],
    ["not enforced CHECK", [primaryKey, { ...check, enforced: false }]],
    ["deferrable primary key", [{ ...primaryKey, deferrable: true }, check]],
    ["changed CHECK inheritance", [primaryKey, { ...check, no_inherit: true }]],
])("still rejects %s alongside native NOT NULL constraints", (_name, constraints) => {
    expect(() => assertTableConstraintInventory(table,
        [...constraints, ...requiredFields.map(notNull)], expectedNames, requiredFields))
        .toThrow(`constraint inventory mismatch ${table}`)
})
