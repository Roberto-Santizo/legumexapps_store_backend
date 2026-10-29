import { schemaTriggers } from "./schemaExtras"
﻿import { randomUUID } from "node:crypto"
import { Sequelize, Model, Table, Column, DataType } from "sequelize-typescript"
import { databaseModels } from "./models"
import { bootstrapDatabase } from "./bootstrap"
import { synchronizeSchema } from "./schemaSync"
import { synchronizeDevelopment } from "./developmentSync"
import { runSeeders } from "./seeders"
import { ownedPostgresEnabled, verifyOwnedPostgres } from "../shared/test-utils/ownedPostgres"
const { Client } = require("pg")
const { main } = require("../../scripts/schema-sync.cjs")
const suite = ownedPostgresEnabled() ? describe : describe.skip

@Table({ tableName: "syncExample", timestamps: false })
class SyncExample extends Model {
    @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true }) declare id: number
    @Column(DataType.STRING) declare label: string
}

suite("additive model synchronization on owned PostgreSQL", () => {
    let owner: any
    const opened: Sequelize[] = []
    beforeAll(async () => { owner = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: false }); await owner.connect(); await verifyOwnedPostgres(owner) })
    afterAll(async () => { for (const db of opened) await db.close(); await owner?.end() })
    async function fresh(initialize=true) {
        await verifyOwnedPostgres(owner)
        const url = new URL(process.env.TEST_APP_DATABASE_URL!)
        const name = `sync_${randomUUID().replace(/-/g, "")}`
        await owner.query(`CREATE DATABASE "${name}" OWNER "${url.username}"`)
        url.pathname = `/${name}`
        const db = new Sequelize(url.href, { dialect: "postgres", logging: false, models: databaseModels, dialectOptions: { ssl: false } })
        opened.push(db)
        if(initialize) await bootstrapDatabase(db, { username: "sync-admin", password: "Synthetic-sync-password-2026" })
        return { db, url }
    }
    const rows = async (db: Sequelize, sql: string) => (await db.query(sql))[0] as any[]
    test("development alter accepts leftover enums, creates required references and preserves users on restart",async()=>{
        const {db}=await fresh(false)
        const previousUser=process.env.BOOTSTRAP_ADMIN_USERNAME,previousPassword=process.env.BOOTSTRAP_ADMIN_PASSWORD
        process.env.BOOTSTRAP_ADMIN_USERNAME="dev-admin"
        process.env.BOOTSTRAP_ADMIN_PASSWORD="Synthetic-local-password-2026"
        try {
            await db.query("CREATE TYPE public.enum_leads_status AS ENUM ('new','contacted')")
            await synchronizeDevelopment(db,"development")
            await runSeeders(db)
            const before=await rows(db,'SELECT * FROM users')
            expect(before).toHaveLength(1)
            await synchronizeDevelopment(db,"development")
            await runSeeders(db)
            expect(await rows(db,'SELECT * FROM users')).toEqual(before)
            expect((await rows(db,'SELECT count(*)::int AS count FROM permissions'))[0].count).toBe(87)
            expect((await rows(db,'SELECT count(*)::int AS count FROM units'))[0].count).toBe(10)
            expect((await rows(db,"SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal"))[0].count).toBe(schemaTriggers.length)
            await expect(synchronizeDevelopment(db,"production")).rejects.toThrow('development-only')
        } finally {
            if(previousUser===undefined)delete process.env.BOOTSTRAP_ADMIN_USERNAME;else process.env.BOOTSTRAP_ADMIN_USERNAME=previousUser
            if(previousPassword===undefined)delete process.env.BOOTSTRAP_ADMIN_PASSWORD;else process.env.BOOTSTRAP_ADMIN_PASSWORD=previousPassword
        }
    },60000)
    function add(db: Sequelize, name: string, attribute: any) {
        const model: any = db.modelManager.models.find(item => String(item.getTableName()) === "users")!
        model.rawAttributes[name] = { ...attribute, field: name }
        model.refreshAttributes()
        return () => { delete model.rawAttributes[name]; model.refreshAttributes() }
    }
    test("creates a registered table, adds nullable and defaulted columns, preserves data and is idempotent", async () => {
        const { db } = await fresh()
        const before = await rows(db, 'SELECT * FROM users')
        const restore = [add(db, "syncNote", { type: DataType.STRING, allowNull: true }), add(db, "syncCount", { type: DataType.INTEGER, allowNull: false, defaultValue: 7 })]
        try {
            db.addModels([SyncExample])
            await synchronizeSchema(db)
            expect(await rows(db, 'SELECT "syncNote","syncCount" FROM users')).toEqual([{ syncNote: null, syncCount: 7 }])
            await db.query("INSERT INTO \"syncExample\"(label) VALUES ('kept')")
            await synchronizeSchema(db)
            expect(await rows(db, 'SELECT label FROM "syncExample"')).toEqual([{ label: "kept" }])
            const after = await rows(db, 'SELECT * FROM users')
            expect(after.map(({ syncNote, syncCount, ...user }) => user)).toEqual(before)
        } finally { restore.forEach(fn => fn()) }
    }, 60000)
    test.each([
        ["required without default", { type: DataType.STRING, allowNull: false }],
        ["foreign key", { type: DataType.INTEGER, references: { model: "roles", key: "id" } }],
        ["expression default", { type: DataType.DATE, defaultValue: Sequelize.literal("NOW()") }],
    ])("blocks unsafe new column: %s", async (_name, attribute) => {
        const { db } = await fresh(), before = await rows(db, 'SELECT * FROM users')
        const restore = add(db, "unsafeAddition", attribute)
        try { await expect(synchronizeSchema(db)).rejects.toThrow("unsafe new column") } finally { restore() }
        expect(await rows(db, 'SELECT * FROM users')).toEqual(before)
    }, 60000)
    test.each(["change", "remove"])("rejects an existing column %s and preserves rows", async action => {
        const { db } = await fresh(), before = await rows(db, 'SELECT * FROM users')
        const model: any = db.modelManager.models.find(item => String(item.getTableName()) === "users")!
        const original = model.rawAttributes.username
        if (action === "remove") delete model.rawAttributes.username
        else model.rawAttributes.username = { ...original, type: DataType.INTEGER() }
        model.refreshAttributes()
        try { await expect(synchronizeSchema(db)).rejects.toThrow("Database schema incompatible") }
        finally { model.rawAttributes.username = original; model.refreshAttributes() }
        expect(await rows(db, 'SELECT * FROM users')).toEqual(before)
    }, 60000)
    test("DDL failure rolls back all additions", async () => {
        const { db } = await fresh(), before = await rows(db, 'SELECT * FROM users')
        const restore = add(db, "rollbackAddition", { type: DataType.STRING, allowNull: true })
        const original = db.sync.bind(db)
        const spy = jest.spyOn(db, "sync").mockImplementation(async options => { await original(options); throw Error("Synthetic post-DDL failure") })
        try { await expect(synchronizeSchema(db)).rejects.toThrow("Synthetic post-DDL") }
        finally { spy.mockRestore(); restore() }
        expect(await rows(db, 'SELECT * FROM users')).toEqual(before)
    }, 60000)
    test("development CLI uses the selected existing connection; production rejects missing confirmation before connecting", async () => {
        const { db, url } = await fresh()
        await db.close()
        await main(["development"], { DEV_DATABASE_URL: url.href })
        const verifyBuild = async () => undefined
        await expect(main(["production"], { PROD_DATABASE_URL: "postgres://test:secret@127.0.0.1:1/never_connect?sslmode=verify-full" }, { verifyBuild, confirm: async () => "wrong" })).rejects.toThrow("confirmation incorrect")
    }, 60000)
})



