import { Column, DataType, Model, Sequelize, Table } from "sequelize-typescript"
import type { Transaction } from "sequelize"
import { synchronizeDevelopment } from "./developmentSync"
import { installPostgresComplements } from "./schemaCreation"

jest.mock("./schemaCreation", () => ({ installPostgresComplements: jest.fn() }))

@Table({
    tableName: "syncFixtures",
    timestamps: false
})
class SyncFixture extends Model {
    @Column({
        type: DataType.STRING,
        unique: true
    })
    declare reference: string

    @Column({
        type: DataType.STRING,
        unique: true
    })
    declare newCode: string
}

const db = new Sequelize({ dialect: "postgres", logging: false, models: [SyncFixture] })
const transaction = {} as Transaction

beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined)
    jest.mocked(installPostgresComplements).mockReset().mockResolvedValue(undefined)
    const executeTransaction = async (work: (value: Transaction) => Promise<unknown>) => work(transaction)
    jest.spyOn(db, "transaction").mockImplementation(executeTransaction as typeof db.transaction)
    jest.spyOn(db, "query").mockResolvedValue([] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{ tablename: "syncFixtures" }] as never)
        .mockResolvedValueOnce([{ table_name: "syncFixtures", column_name: "reference" }] as never)
    jest.spyOn(db, "sync").mockImplementation(async () => {
        expect(SyncFixture.rawAttributes.reference.unique).toBe(false)
        expect(SyncFixture.rawAttributes.newCode.unique).toBe(true)
        return db
    })
})

afterEach(() => jest.restoreAllMocks())
afterAll(() => db.close())

test("reuses existing uniqueness while retaining declarations for new unique columns", async () => {
    await synchronizeDevelopment(db, "development")
    expect(db.sync).toHaveBeenCalledWith({ alter: true, force: false, transaction })
    expect(SyncFixture.rawAttributes.reference.unique).toBe(true)
    expect(SyncFixture.rawAttributes.newCode.unique).toBe(true)
    expect(installPostgresComplements).toHaveBeenCalledWith(db, transaction)
})

test("restores model declarations and skips complement installation after a failed sync", async () => {
    jest.mocked(db.sync).mockImplementationOnce(async () => {
        expect(SyncFixture.rawAttributes.reference.unique).toBe(false)
        throw new Error("synthetic sync failure")
    })
    await expect(synchronizeDevelopment(db, "development")).rejects.toThrow("synthetic sync failure")
    expect(SyncFixture.rawAttributes.reference.unique).toBe(true)
    expect(SyncFixture.rawAttributes.newCode.unique).toBe(true)
    expect(installPostgresComplements).not.toHaveBeenCalled()
})

test("rejects production mode before any database operation", async () => {
    await expect(synchronizeDevelopment(db, "production")).rejects.toThrow("development-only")
    expect(db.transaction).not.toHaveBeenCalled()
    expect(db.query).not.toHaveBeenCalled()
    expect(db.sync).not.toHaveBeenCalled()
})
