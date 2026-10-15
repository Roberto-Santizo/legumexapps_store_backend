// Opt-in real PostgreSQL integration (scripts/test-postgres.cjs only). Uses its own database inside
// the harness's newly-created loopback cluster, built from the full SQL migration chain.
jest.mock("../../../config/env", () => {
    const raw = process.env.TEST_DATABASE_URL
    let databaseUrl = "postgres://unused:unused@127.0.0.1:1/unused"
    if (raw) {
        const url = new URL(raw)
        url.pathname = `${url.pathname}_rmt`
        databaseUrl = url.toString()
    }
    return { env: { databaseUrl, nodeEnv: "test" } }
})

import { ownedPostgresEnabled, verifyOwnedPostgres } from "../../../shared/test-utils/ownedPostgres"
import sequelize from "../../../database/connection"
import { assertSchemaReady } from "../../../database/schemaReadiness"
import { rawMaterialTransformationService as service } from "./rawMaterialTransformation.service"
import { rawMaterialService } from "../../rawMaterial/services/rawMaterial.service"
import RawMaterialTransformationCost from "../models/RawMaterialTransformationCost.model"
import type { SaveRawMaterialTransformationInput } from "../schemas/rawMaterialTransformation.schema"
const { Client: PgClient } = require("pg")
const { migrate, readPlan } = require("../../../../scripts/migrate.cjs")

const banana: SaveRawMaterialTransformationInput = {
    unprocessedCode: "BAN-001", unprocessedName: "BANANO", processedCode: "BAN-P-001", processedName: "BANANO PROCESADO",
    processedNameEn: "PROCESSED BANANA", ingredientType: "fruit",
    inputCostPerPound: 0.52, inputCurrency: "GTQ", freightPerPound: 0, freightCurrency: "GTQ", yieldPercentage: 45, exchangeRate: 7.65,
    costs: [
        { category: "direct_labor", conceptName: "LAVADO", amount: 0.0051201704489003295, currency: "USD", costBasis: "per_processed_pound" },
        { category: "direct_labor", conceptName: "RECORTE", amount: 0.04829557732917848, currency: "USD", costBasis: "per_processed_pound" },
        { category: "direct_labor", conceptName: "PROCESO", amount: 0.009125984810098001, currency: "USD", costBasis: "per_processed_pound" },
        { category: "packaging", conceptName: "BOLSA", amount: 0.005460526315789474, currency: "USD", costBasis: "per_processed_pound" },
        { category: "packaging", conceptName: "STICKER", amount: 0.0026315789473684214, currency: "USD", costBasis: "per_processed_pound" },
        { category: "other", conceptName: "ELECTRICIDAD", amount: 0, currency: "USD", costBasis: "per_processed_pound" },
        { category: "other", conceptName: "BUNKER O DIESEL", amount: 0, currency: "USD", costBasis: "per_processed_pound" },
        { category: "other", conceptName: "SANITIZACIÓN", amount: 0.005, currency: "USD", costBasis: "per_processed_pound" },
    ],
}

const integration = ownedPostgresEnabled() ? describe : describe.skip
integration("raw material transformations — PostgreSQL", () => {
    let owner: any
    let database: any
    let databaseName = ""
    let created = false
    const count = async (table: string) => Number((await database.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n)

    beforeAll(async () => {
        owner = new PgClient({ connectionString: process.env.TEST_DATABASE_URL })
        await owner.connect()
        await verifyOwnedPostgres(owner)
        databaseName = `${new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1)}_rmt`
        if (!/^legumex_test_[a-f0-9]{32}_rmt$/.test(databaseName)) throw new Error("Unexpected integration database name")
        await owner.query(`CREATE DATABASE "${databaseName}"`)
        created = true
        const url = new URL(process.env.TEST_DATABASE_URL!)
        url.pathname = `/${databaseName}`
        database = new PgClient({ connectionString: url.toString() })
        await database.connect()
        await migrate(database, await readPlan())
        // Test URL controls TLS; local temporary PostgreSQL has no TLS configured.
        sequelize.addHook("beforeConnect", (config: any) => { config.dialectOptions = {} })
        await sequelize.authenticate()
    }, 60000)
    beforeEach(async () => {
        await database.query('TRUNCATE "rawMaterialTransformationCosts", "rawMaterialTransformations", "unprocessedRawMaterials", "rawMaterialTranslations", "productRawMaterials", "rawMaterials" RESTART IDENTITY CASCADE')
    })
    afterAll(async () => {
        await sequelize.close()
        if (database) await database.end()
        if (created) await owner.query(`DROP DATABASE "${databaseName}"`)
        if (owner) await owner.end()
    })

    test("the migrated schema matches every Sequelize model (startup readiness check)", async () => {
        await database.query("BEGIN READ ONLY")
        try { await assertSchemaReady(database, sequelize) } finally { await database.query("ROLLBACK") }
    })

    test("create writes source, catalog raw material, transformation and cost lines with explicit links", async () => {
        const detail = await service.createTransformation(banana)
        expect(detail.processedCostUsd).toBe(0.226686851649)
        expect(detail.catalogCostPerPound).toBe(0.2267)
        expect(detail.costs).toHaveLength(8)
        const { rows } = await database.query(`SELECT u.code AS source, r.code AS processed, r."costPerUnit", t."processedCostUsd", un."baseFactor",
            (SELECT "displayName" FROM "rawMaterialTranslations" WHERE "rawMaterialId" = r.id AND language = 'en') AS en
            FROM "rawMaterialTransformations" t
            JOIN "unprocessedRawMaterials" u ON u.id = t."unprocessedRawMaterialId"
            JOIN "rawMaterials" r ON r.id = t."processedRawMaterialId"
            JOIN units un ON un.id = r."costUnitId"`)
        expect(rows).toEqual([{ source: "BAN-001", processed: "BAN-P-001", costPerUnit: "0.2267", processedCostUsd: "0.226686851649", baseFactor: expect.any(String), en: "PROCESSED BANANA" }])
        // El cotizador lee rawMaterials.costPerUnit en libras: es un registro normal del catálogo.
        expect(Number(rows[0].baseFactor)).toBeCloseTo(453.592, 3)
        const totals = await database.query(`SELECT category, sum("costUsdPerProcessedPound")::text AS total FROM "rawMaterialTransformationCosts" GROUP BY category ORDER BY category`)
        expect(totals.rows).toEqual([
            { category: "direct_labor", total: "0.062541732588" },
            { category: "packaging", total: "0.008092105263" },
            { category: "other", total: "0.005000000000" },
        ])
    })

    test("duplicate processed code (any case) is rejected with no partial rows", async () => {
        await service.createTransformation(banana)
        await expect(service.createTransformation({ ...banana, unprocessedCode: "BAN-002", processedCode: "ban-p-001" })).rejects.toMatchObject({ statusCode: 409 })
        expect(await count("unprocessedRawMaterials")).toBe(1)
        expect(await count("rawMaterials")).toBe(1)
        expect(await count("rawMaterialTransformations")).toBe(1)
    })

    test("a failure after the catalog row was written rolls back the whole operation", async () => {
        const spy = jest.spyOn(RawMaterialTransformationCost, "bulkCreate").mockRejectedValueOnce(new Error("synthetic failure"))
        await expect(service.createTransformation(banana)).rejects.toThrow("synthetic failure")
        spy.mockRestore()
        for (const table of ["unprocessedRawMaterials", "rawMaterials", "rawMaterialTranslations", "rawMaterialTransformations", "rawMaterialTransformationCosts"]) {
            expect(await count(table)).toBe(0)
        }
    })

    test("one source feeds several processed raw materials; a new source cost recalculates the others", async () => {
        const first = await service.createTransformation(banana)
        const second = await service.createTransformation({ ...banana, processedCode: "BAN-R-001", processedName: "BANANO RODAJAS", inputCostPerPound: 0.6, yieldPercentage: 50, costs: [] })
        expect(await count("unprocessedRawMaterials")).toBe(1)
        expect(second.siblingCount).toBe(1)
        const reloaded = await service.getTransformationById(first.id)
        // 0.60 / 7.65 / 0.45 + 0.0756338... : el origen compartido cambió y la primera se recalculó.
        expect(reloaded.inputCostPerPound).toBe(0.6)
        expect(reloaded.processedCostUsd).toBe(0.249925776849)
        expect(reloaded.catalogCostPerPound).toBe(0.2499)
        expect(second.processedCostUsd).toBe(0.156862745098)
    })

    test("edit recalculates and updates the SAME catalog row; cost lines are replaced; no duplicate", async () => {
        const created = await service.createTransformation(banana)
        const updated = await service.updateTransformation(created.id, { ...banana, processedName: "BANANO PELADO", yieldPercentage: 50, costs: banana.costs.slice(0, 2) })
        expect(updated.processedRawMaterialId).toBe(created.processedRawMaterialId)
        expect(updated.processedName).toBe("BANANO PELADO")
        expect(updated.costs).toHaveLength(2)
        expect(await count("rawMaterials")).toBe(1)
        expect(await count("rawMaterialTransformationCosts")).toBe(2)
        const { rows } = await database.query('SELECT "costPerUnit" FROM "rawMaterials"')
        expect(Number(rows[0].costPerUnit)).toBe(updated.catalogCostPerPound)
        const recalculated = await service.recalculateTransformation(created.id)
        expect(recalculated.processedCostUsd).toBe(updated.processedCostUsd)
    })

    test("moving a transformation to another source removes the orphaned source", async () => {
        const created = await service.createTransformation(banana)
        await service.updateTransformation(created.id, { ...banana, unprocessedCode: "BAN-002", unprocessedName: "BANANO B" })
        const { rows } = await database.query('SELECT code FROM "unprocessedRawMaterials"')
        expect(rows).toEqual([{ code: "BAN-002" }])
    })

    test("concurrent creates of the same new source serialize and share one source row", async () => {
        await Promise.all([
            service.createTransformation(banana),
            service.createTransformation({ ...banana, processedCode: "BAN-R-001", processedName: "BANANO RODAJAS" }),
        ])
        expect(await count("unprocessedRawMaterials")).toBe(1)
        expect(await count("rawMaterialTransformations")).toBe(2)
    })

    test("list searches by unprocessed or processed code/name with pagination", async () => {
        await service.createTransformation(banana)
        await service.createTransformation({ ...banana, unprocessedCode: "PIN-001", unprocessedName: "PIÑA", processedCode: "PIN-P-001", processedName: "PIÑA PROCESADA" })
        const byProcessed = await service.listTransformations({ page: 1, limit: 10 }, "pin-p")
        expect(byProcessed.data.map(row => row.processedCode)).toEqual(["PIN-P-001"])
        expect(byProcessed.meta?.total).toBe(1)
        const bySource = await service.listTransformations({ page: 1, limit: 1 }, "BAN")
        expect(bySource.data.map(row => row.unprocessedCode)).toEqual(["BAN-001"])
        expect((await service.listTransformations()).data).toHaveLength(2)
        expect((await service.listSources()).map(row => [row.code, row.transformationCount])).toEqual([["BAN-001", 1], ["PIN-001", 1]])
    })

    test("the raw material CRUD cannot change a managed cost, but still edits other fields; unmanaged costs stay editable", async () => {
        const created = await service.createTransformation(banana)
        const id = created.processedRawMaterialId
        await expect(rawMaterialService.updateRawMaterial(id, { code: "BAN-P-001", costPerUnit: 0.5 })).rejects.toMatchObject({ statusCode: 409 })
        const renamed = await rawMaterialService.updateRawMaterial(id, { code: "BAN-P-001", displayName: "BANANO PELADO", costPerUnit: 0.2267 })
        expect(renamed.displayName).toBe("BANANO PELADO")
        expect(renamed.transformation?.id).toBe(created.id)
        const plain = await rawMaterialService.createRawMaterial({ code: "MAN-001", displayName: "MANGO", ingredientType: "fruit", costPerUnit: 1 })
        const changed = await rawMaterialService.updateRawMaterial(plain.id, { code: "MAN-001", costPerUnit: 1.25 })
        expect(Number(changed.costPerUnit)).toBe(1.25)
        expect(changed.transformation ?? null).toBeNull()
    })

    test("database constraints enforce integrity independently of the application", async () => {
        const created = await service.createTransformation(banana)
        await expect(database.query('UPDATE "rawMaterialTransformations" SET "yieldPercentage" = 0')).rejects.toMatchObject({ code: "23514" })
        await expect(database.query(`UPDATE "rawMaterialTransformationCosts" SET "poundsPerUnit" = NULL, "costBasis" = 'per_unit'`)).rejects.toMatchObject({ code: "23514" })
        await expect(database.query(`DELETE FROM "rawMaterials" WHERE id = ${created.processedRawMaterialId}`)).rejects.toMatchObject({ code: "23503" })
        await expect(database.query('DELETE FROM "unprocessedRawMaterials"')).rejects.toMatchObject({ code: "23503" })
        await expect(database.query(`INSERT INTO "unprocessedRawMaterials" (code, "displayName", "costPerPound", "costCurrency", "createdAt", "updatedAt") VALUES ('ban-001', 'X', 1, 'USD', now(), now())`)).rejects.toMatchObject({ code: "23505" })
        await database.query(`DELETE FROM "rawMaterialTransformations" WHERE id = ${created.id}`)
        expect(await count("rawMaterialTransformationCosts")).toBe(0)
    })
})
