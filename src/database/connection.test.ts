jest.mock("../config/env", () => ({ env: {
    databaseUrl: "postgres://synthetic:synthetic@127.0.0.1:1/unused", nodeEnv: "test", dbSyncAlter: false,
} }))
jest.mock("./seeders", () => ({ runSeeders: jest.fn() }))
jest.mock("./schemaReadiness", () => ({ assertDatabaseReady: jest.fn(), assertApplicationRole: jest.fn() }))
import sequelize, { connectDB } from "./connection"
import { env } from "../config/env"
import { runSeeders } from "./seeders"
import { assertApplicationRole, assertDatabaseReady } from "./schemaReadiness"

const configuration = env as unknown as { nodeEnv: string; dbSyncAlter: boolean }
const exitSignal = new Error("simulated process exit")
beforeEach(() => {
    configuration.dbSyncAlter = false
    configuration.nodeEnv = "test"
    jest.spyOn(sequelize, "authenticate").mockResolvedValue(undefined)
    jest.spyOn(sequelize, "sync").mockResolvedValue(sequelize)
    jest.spyOn(sequelize, "query").mockResolvedValue([] as never)
    jest.spyOn(sequelize, "transaction").mockImplementation((async (_options: unknown, callback: any) => callback({ id: "readonly-fixture" })) as never)
    jest.spyOn(console, "error").mockImplementation(() => {})
    jest.spyOn(console, "log").mockImplementation(() => {})
    jest.spyOn(process, "exit").mockImplementation(() => { throw exitSignal })
    jest.mocked(assertDatabaseReady).mockReset().mockResolvedValue(undefined)
    jest.mocked(assertApplicationRole).mockReset().mockResolvedValue(undefined)
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { await sequelize.close() })
test.each(["development", "test", "production"])("blocks alter in %s before any database operation", async mode => {
    configuration.nodeEnv = mode
    configuration.dbSyncAlter = true
    await expect(connectDB()).rejects.toBe(exitSignal)
    expect(sequelize.authenticate).not.toHaveBeenCalled()
    expect(sequelize.query).not.toHaveBeenCalled()
    expect(sequelize.sync).not.toHaveBeenCalled()
    expect(runSeeders).not.toHaveBeenCalled()
})
test.each(["development", "test", "production"])("startup in %s verifies in a read-only transaction without sync or seeds", async mode => {
    configuration.nodeEnv = mode
    await connectDB()
    expect(sequelize.authenticate).toHaveBeenCalledTimes(1)
    expect(sequelize.transaction).toHaveBeenCalledWith({ readOnly: true, isolationLevel: "REPEATABLE READ" }, expect.any(Function))
    expect(assertDatabaseReady).toHaveBeenCalledTimes(1)
    expect(sequelize.query).toHaveBeenCalledWith("SET TRANSACTION READ ONLY", expect.objectContaining({ transaction: expect.any(Object) }))
    expect(sequelize.sync).not.toHaveBeenCalled()
    expect(runSeeders).not.toHaveBeenCalled()
    expect(process.exit).not.toHaveBeenCalled()
})
test("administrator database credentials are rejected without schema writes", async () => {
    jest.mocked(assertApplicationRole).mockRejectedValueOnce(new Error("unsafe database role"))
    await expect(connectDB()).rejects.toBe(exitSignal)
    expect(assertDatabaseReady).not.toHaveBeenCalled()
    expect(sequelize.sync).not.toHaveBeenCalled()
    expect(runSeeders).not.toHaveBeenCalled()
})
test.each(["missing ledger", "missing version", "changed checksum", "missing column", "missing seed", "password=synthetic-secret"])("fails closed for %s without exposing driver details", async reason => {
    jest.mocked(assertDatabaseReady).mockRejectedValueOnce(new Error(reason))
    await expect(connectDB()).rejects.toBe(exitSignal)
    expect(process.exit).toHaveBeenCalledWith(1)
    expect(sequelize.sync).not.toHaveBeenCalled()
    expect(runSeeders).not.toHaveBeenCalled()
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(reason)
})
