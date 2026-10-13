import { parseDbSyncAlter } from "./dbSyncAlter"

test.each([[undefined, false], ["false", false], ["true", true]] as const)("accepts %s", (value, expected) => {
    expect(parseDbSyncAlter(value)).toBe(expected)
})
test.each(["TRUE", "FALSE", "1", "0", "", " true", "true ", " false ", "\tfalse", "false\n", "yes"])("rejects explicit invalid value %j safely", value => {
    expect(() => parseDbSyncAlter(value)).toThrow(/^Invalid DB_SYNC_ALTER: expected exactly true, false, or an absent variable$/)
})
