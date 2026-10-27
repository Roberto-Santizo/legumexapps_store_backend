jest.mock("../config/env", () => ({ env: {
    databaseUrl: "postgres://synthetic:synthetic@127.0.0.1:1/unused", nodeEnv: "test", dbSyncAlter: false,
} }))
jest.mock("./schemaReadiness", () => ({ assertDatabaseReady: jest.fn(), assertApplicationRole: jest.fn(), assertPostgresCapabilities: jest.fn(), SchemaCompatibilityError: class extends Error {} }))
jest.mock("./developmentSync", () => ({synchronizeDevelopment:jest.fn()}))
jest.mock("./seeders",()=>({runSeeders:jest.fn()}))
import { runSeeders } from "./seeders"
import { synchronizeDevelopment } from "./developmentSync"
import sequelize, { connectDB } from "./connection"
import { env } from "../config/env"
import { assertApplicationRole, assertDatabaseReady, assertPostgresCapabilities } from "./schemaReadiness"

const configuration = env as unknown as { nodeEnv: string; dbSyncAlter: boolean; databaseRolePolicy?: "owner" | "restricted" }
const exitSignal = new Error("simulated process exit")
beforeEach(() => {
    delete process.env.npm_lifecycle_event
    jest.mocked(synchronizeDevelopment).mockReset().mockResolvedValue(undefined)
    jest.mocked(runSeeders).mockReset().mockResolvedValue(undefined)
    configuration.dbSyncAlter = false
    configuration.nodeEnv = "test"
    configuration.databaseRolePolicy = "restricted"
    jest.spyOn(sequelize, "authenticate").mockResolvedValue(undefined)
    jest.spyOn(sequelize, "sync").mockResolvedValue(sequelize)
    jest.spyOn(sequelize, "query").mockResolvedValue([] as never)
    jest.spyOn(sequelize, "transaction").mockImplementation((async (_options: unknown, callback: any) => callback({ id: "readonly-fixture" })) as never)
    jest.spyOn(console, "error").mockImplementation(() => {})
    jest.spyOn(console, "log").mockImplementation(() => {})
    jest.spyOn(console, "warn").mockImplementation(() => {})
    jest.spyOn(process, "exit").mockImplementation(() => { throw exitSignal })
    jest.mocked(assertDatabaseReady).mockReset().mockResolvedValue(undefined)
    jest.mocked(assertApplicationRole).mockReset().mockResolvedValue(undefined)
    jest.mocked(assertPostgresCapabilities).mockReset().mockResolvedValue(undefined)
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { await sequelize.close() })
test.each(["test", "production"])("blocks alter in %s before any database operation", async mode => {
    configuration.nodeEnv = mode
    configuration.dbSyncAlter = true
    await expect(connectDB()).rejects.toBe(exitSignal)
    expect(sequelize.authenticate).not.toHaveBeenCalled()
    expect(sequelize.query).not.toHaveBeenCalled()
    expect(sequelize.sync).not.toHaveBeenCalled()
})

test("npm run dev synchronizes only development and does not require empty-database bootstrap",async()=>{
    configuration.nodeEnv="development"
    process.env.npm_lifecycle_event="dev"
    await connectDB()
    expect(synchronizeDevelopment).toHaveBeenCalledWith(sequelize,"development")
    expect(runSeeders).toHaveBeenCalledWith(sequelize)
    expect(jest.mocked(synchronizeDevelopment).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(runSeeders).mock.invocationCallOrder[0])
    expect(assertDatabaseReady).not.toHaveBeenCalled()
})

test("development reports a PostgreSQL lock without revealing driver details or running seeders",async()=>{
    configuration.nodeEnv="development"
    process.env.npm_lifecycle_event="dev"
    jest.mocked(synchronizeDevelopment).mockRejectedValueOnce({original:{code:'55P03'},message:'private-password'})
    await expect(connectDB()).rejects.toBe(exitSignal)
    expect(runSeeders).not.toHaveBeenCalled()
    const diagnostic=JSON.stringify(jest.mocked(console.error).mock.calls)
    expect(diagnostic).toContain('55P03')
    expect(diagnostic).toContain('bloqueo')
    expect(diagnostic).not.toContain('private-password')
})

test("invalid administrator credentials explain the seed rollback without exposing the password",async()=>{
    configuration.nodeEnv="development"
    process.env.npm_lifecycle_event="dev"
    jest.mocked(runSeeders).mockRejectedValueOnce(new Error('Invalid bootstrap credentials; private-password'))
    await expect(connectDB()).rejects.toBe(exitSignal)
    const diagnostic=JSON.stringify(jest.mocked(console.error).mock.calls)
    expect(diagnostic).toContain('SEED_ADMIN_PASSWORD')
    expect(diagnostic).toContain('16 caracteres')
    expect(diagnostic).not.toContain('private-password')
})

test("npm start cannot synchronize even when NODE_ENV defaults to development",async()=>{
    configuration.nodeEnv="development"
    process.env.npm_lifecycle_event="start"
    await connectDB()
    expect(synchronizeDevelopment).not.toHaveBeenCalled()
    expect(runSeeders).not.toHaveBeenCalled()
    expect(assertDatabaseReady).toHaveBeenCalledTimes(1)
})

test("production cannot synchronize even under npm run dev",async()=>{
    configuration.nodeEnv="production"
    process.env.npm_lifecycle_event="dev"
    await connectDB()
    expect(synchronizeDevelopment).not.toHaveBeenCalled()
    expect(assertDatabaseReady).toHaveBeenCalledTimes(1)
})
test.each(["development", "test", "production"])("startup in %s verifies in a read-only transaction without sync or seeds", async mode => {
    configuration.nodeEnv = mode
    await connectDB()
    expect(sequelize.authenticate).toHaveBeenCalledTimes(1)
    expect(sequelize.transaction).toHaveBeenCalledWith({ readOnly: true, isolationLevel: "REPEATABLE READ" }, expect.any(Function))
    expect(assertDatabaseReady).toHaveBeenCalledTimes(1)
    expect(sequelize.query).toHaveBeenCalledWith("SET TRANSACTION READ ONLY", expect.objectContaining({ transaction: expect.any(Object) }))
    expect(sequelize.sync).not.toHaveBeenCalled()
    expect(process.exit).not.toHaveBeenCalled()
})
test("administrator database credentials are rejected without schema writes", async () => {
    jest.mocked(assertApplicationRole).mockRejectedValueOnce(new Error("unsafe database role"))
    await expect(connectDB()).rejects.toBe(exitSignal)
    expect(assertDatabaseReady).not.toHaveBeenCalled()
    expect(sequelize.sync).not.toHaveBeenCalled()
})

test("unsupported PostgreSQL version is rejected before inspecting privileges on application tables", async () => {
    jest.mocked(assertPostgresCapabilities).mockRejectedValueOnce(new Error("unsupported PostgreSQL version"))
    await expect(connectDB()).rejects.toBe(exitSignal)
    expect(assertApplicationRole).not.toHaveBeenCalled()
    expect(assertDatabaseReady).not.toHaveBeenCalled()
    expect(sequelize.sync).not.toHaveBeenCalled()
})

test("explicit owner policy reaches role inspection without bypassing schema checks, sync or seeds", async () => {
    configuration.databaseRolePolicy = "owner"
    await connectDB()
    expect(assertApplicationRole).toHaveBeenCalledWith(expect.any(Object), "owner")
    expect(assertDatabaseReady).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("DB_ROLE_POLICY=owner"))
    expect(sequelize.sync).not.toHaveBeenCalled()
})
test.each(["missing current schema", "unsupported PostgreSQL version", "changed constraint", "missing column", "missing initial references", "password=synthetic-secret"])("fails closed for %s without exposing driver details", async reason => {
    jest.mocked(assertDatabaseReady).mockRejectedValueOnce(new Error(reason))
    await expect(connectDB()).rejects.toBe(exitSignal)
    expect(process.exit).toHaveBeenCalledWith(1)
    expect(sequelize.sync).not.toHaveBeenCalled()
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(reason)
})
