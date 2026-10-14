// Opt-in real PostgreSQL integration; never loads application credentials or starts sync/seeders.
jest.mock("../../../config/env", () => ({ env: {
    databaseUrl: process.env.TEST_DATABASE_URL ?? "postgres://unused:unused@127.0.0.1:1/unused",
    nodeEnv: "test",
} }))

import { createPackagingDatabase } from "../../../shared/test-utils/packagingDatabase"
import { ownedPostgresEnabled, verifyOwnedPostgres } from "../../../shared/test-utils/ownedPostgres"
import { randomUUID } from "node:crypto"
import sequelize from "../../../database/connection"
import { representativeClientService as service } from "./representativeClient.service"
import Salesperson from "../models/Salesperson.model"
import ClientModel from "../../client/models/Client.model"
import RepresentativeClient from "../models/RepresentativeClient.model"
const { Client: PgClient } = require("pg")
const { migrate, readPlan } = require("../../../../scripts/migrate.cjs")

const integration = ownedPostgresEnabled() ? describe : describe.skip
integration("representative clients â€” PostgreSQL", () => {
    const schema = `test_rep_clients_${randomUUID().replace(/-/g, "")}`
    let database: any
    let created = false
    beforeAll(async () => {
        database = new PgClient({ connectionString: process.env.TEST_DATABASE_URL })
        await database.connect()
        await verifyOwnedPostgres(database)
        await database.query(`CREATE SCHEMA "${schema}"`)
        created = true
        await database.query(`SET search_path TO "${schema}"`)
        await database.query('CREATE TABLE customers (id INTEGER PRIMARY KEY, "isActive" BOOLEAN NOT NULL)')
        await database.query('CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT NOT NULL, "isActive" BOOLEAN NOT NULL)')
        await createPackagingDatabase(database)
        await migrate(database, (await readPlan()).filter((item: { version: string }) => ["202610120001_representative_clients.sql", "202610120002_packaging_classification.sql"].includes(item.version)))
        // Test URL controls TLS; local temporary PostgreSQL has no TLS configured.
        sequelize.addHook("beforeConnect", (config: any) => {
            config.dialectOptions = {}
        })
        sequelize.addHook("afterConnect", async (connection: any) => {
            await connection.query(`SET search_path TO "${schema}"`)
        })
        await sequelize.authenticate()
    }, 30000)
    beforeEach(async () => {
        await database.query("TRUNCATE representative_clients, customers, clients")
        await database.query('INSERT INTO customers VALUES (1, true), (2, true), (3, false)')
        await database.query("INSERT INTO clients VALUES (1, 'Alpha', true), (2, 'Beta', true), (3, 'Gamma', true), (4, 'Inactive', false)")
    })
    afterAll(async () => {
        await sequelize.close()
        if (created) await database.query(`DROP SCHEMA "${schema}" CASCADE`)
        if (database) await database.end()
    })

    test("migration is versioned and replay is harmless", async () => {
        await migrate(database, (await readPlan()).filter((item: { version: string }) => ["202610120001_representative_clients.sql", "202610120002_packaging_classification.sql"].includes(item.version)))
        const result = await database.query("SELECT version FROM schema_migrations")
        expect(result.rows.map((row: { version: string }) => row.version).sort()).toEqual(["202610120001_representative_clients.sql", "202610120002_packaging_classification.sql"])
        expect((await database.query("SELECT * FROM representative_clients")).rowCount).toBe(0)
    })
    test("both real Sequelize many-to-many associations work", async () => {
        await service.assign(1, [1, 2])
        const representative = await Salesperson.findOne({ attributes: ["id"], where: { id: 1 }, include: [{ model: ClientModel, as: "assignedClients", attributes: ["id", "name", "isActive"], through: { attributes: [] } }] })
        expect(representative!.assignedClients.map(row => row.id).sort()).toEqual([1, 2])
        const client = await ClientModel.findOne({ attributes: ["id"], where: { id: 1 }, include: [{ model: Salesperson, as: "representatives", attributes: ["id"], through: { attributes: [] } }] })
        expect(client!.representatives.map(row => row.id)).toEqual([1])
    })
    test("concurrent additive batches preserve all assignments and prevent duplicates", async () => {
        await Promise.all([service.assign(1, [1, 2]), service.assign(1, [2, 3]), service.assign(1, [1])])
        expect((await service.list(1)).map(row => row.id)).toEqual([1, 2, 3])
        expect(await RepresentativeClient.count()).toBe(3)
    })
    test("one client can belong to multiple representatives", async () => {
        await Promise.all([service.assign(1, [1]), service.assign(2, [1])])
        await service.remove(1, 1)
        expect(await service.authorizedClientIds(1)).toEqual([])
        expect(await service.authorizedClientIds(2)).toEqual([1])
    })
    test("revocation is immediate, idempotent and requires no token change", async () => {
        await service.assign(1, [1, 2])
        expect(await service.authorizedClientIds(1)).toEqual([1, 2])
        await service.remove(1, 1)
        await service.remove(1, 1)
        expect(await service.authorizedClientIds(1)).toEqual([2])
    })
    test("invalid batches roll back without partial assignments", async () => {
        await expect(service.assign(1, [1, 99])).rejects.toMatchObject({ statusCode: 422 })
        await expect(service.assign(1, [1, 4])).rejects.toMatchObject({ statusCode: 422 })
        await expect(service.assign(99, [1])).rejects.toMatchObject({ statusCode: 404 })
        await expect(service.assign(3, [1])).rejects.toMatchObject({ statusCode: 422 })
        expect(await RepresentativeClient.count()).toBe(0)
    })
    test("inactive clients are retained for management but never authorized", async () => {
        await service.assign(1, [1])
        await database.query('UPDATE clients SET "isActive" = false WHERE id = 1')
        expect(await service.list(1)).toEqual([{ id: 1, name: "Alpha", isActive: false }])
        expect(await service.authorizedClientIds(1)).toEqual([])
        await service.remove(1, 1)
        expect(await service.list(1)).toEqual([])
    })
    test("inactive representative has no authorized clients", async () => {
        await service.assign(1, [1])
        await database.query('UPDATE customers SET "isActive" = false WHERE id = 1')
        expect(await service.authorizedClientIds(1)).toEqual([])
        await service.remove(1, 1)
    })
    test("concurrent assign/remove serialize and an explicit final revocation persists", async () => {
        await service.assign(1, [1])
        await Promise.all([service.assign(1, [1]), service.remove(1, 1)])
        expect(await RepresentativeClient.count()).toBeLessThanOrEqual(1)
        await service.remove(1, 1)
        expect(await service.authorizedClientIds(1)).toEqual([])
    })
    test("real PostgreSQL primary key and foreign keys reject invalid direct writes", async () => {
        await service.assign(1, [1])
        await expect(database.query('INSERT INTO representative_clients VALUES (1, 1)')).rejects.toMatchObject({ code: "23505" })
        await expect(database.query('INSERT INTO representative_clients VALUES (99, 1)')).rejects.toMatchObject({ code: "23503" })
        await expect(database.query('INSERT INTO representative_clients VALUES (1, 99)')).rejects.toMatchObject({ code: "23503" })
        await expect(database.query('DELETE FROM clients WHERE id = 1')).rejects.toMatchObject({ code: "23503" })
        await expect(database.query('DELETE FROM customers WHERE id = 1')).rejects.toMatchObject({ code: "23503" })
    })
    test("changed applied migration checksum is rejected", async () => {
        await database.query("BEGIN")
        try {
            await database.query("UPDATE schema_migrations SET checksum = 'invalid'")
            await expect(migrate(database, (await readPlan()).filter((item: { version: string }) => ["202610120001_representative_clients.sql", "202610120002_packaging_classification.sql"].includes(item.version)))).rejects.toThrow(/^Applied migration checksum mismatch$/i)
        } finally { await database.query("ROLLBACK") }
    })
})
