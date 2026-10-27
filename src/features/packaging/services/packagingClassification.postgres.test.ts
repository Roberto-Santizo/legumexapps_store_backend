import { randomUUID } from "node:crypto"
import { installFixtureProtections } from "../../../shared/test-utils/schemaFixture"
import { join } from "node:path"
import { createPackagingDatabase } from "../../../shared/test-utils/packagingDatabase"
import { ownedPostgresEnabled, verifyOwnedPostgres } from "../../../shared/test-utils/ownedPostgres"
const { Client } = require("pg")
const integration = ownedPostgresEnabled() ? describe : describe.skip

integration("packaging classification — real PostgreSQL", () => {
    const schema = `test_packaging_${randomUUID().replace(/-/g, "")}`
    let db: any
    const connection = async () => {
        const client = new Client({ connectionString: process.env.TEST_DATABASE_URL })
        await client.connect()
        await verifyOwnedPostgres(client)
        await client.query(`SET search_path TO "${schema}"`)
        return client
    }
    beforeAll(async () => {
        db = await connection()
        await db.query(`CREATE SCHEMA "${schema}"`)
        await db.query(`SET search_path TO "${schema}"`)
        await createPackagingDatabase(db)
        await db.query(`INSERT INTO packagings(code,"displayName","packagingRole","unitCost","isActive")
            VALUES ('PRIVATE','Private','unit',0.1234,false)`)
        await db.query('INSERT INTO "productVariantUnitMaterials"("packagingId","isActive") VALUES (1,false)')
        await installFixtureProtections(db)
    })
    afterAll(async () => {
        if (db) {
            await db.query(`DROP SCHEMA "${schema}" CASCADE`)
            await db.end()
        }
    })
    test("backfill preserves identity, code, cost, level, state and inactive associations", async () => {
        expect((await db.query("SELECT * FROM packagings WHERE id=1")).rows[0]).toEqual({ id: 1, code: "PRIVATE", displayName: "Private", packagingRole: "unit", unitCost: "0.1234", isActive: false, classification: "specific", displayNameEn: null })
        expect((await db.query('SELECT * FROM "productVariantUnitMaterials" WHERE id=1')).rows[0]).toEqual({ id: 1, packagingId: 1, isActive: false })
    })
    test.each(["classification='generic'", '"packagingRole"=\'pallet\''])("protects referenced material, including inactive references: %s", async change => {
        await expect(db.query(`UPDATE packagings SET ${change} WHERE id=1`)).rejects.toMatchObject({ constraint: "packaging_associations_protected" })
    })
    test("database validates classification and retains unique internal codes", async () => {
        await expect(db.query("UPDATE packagings SET classification='unknown' WHERE id=1")).rejects.toBeTruthy()
        await expect(db.query(`INSERT INTO packagings(code,"displayName","packagingRole") VALUES ('PRIVATE','Duplicate','unit')`)).rejects.toMatchObject({ code: "23505" })
    })
    test.each(["productVariantUnitMaterials", "productVariantIntermediateMaterials", "productVariantPalletMaterials"])("rejects generic assignment through %s", async table => {
        const { rows } = await db.query(`INSERT INTO packagings(code,"displayName","packagingRole",classification,"unitCost") VALUES ($1,'Generic','unit','generic',1.2345) RETURNING id`, [table])
        await expect(db.query(`INSERT INTO "${table}"("packagingId") VALUES ($1)`, [rows[0].id])).rejects.toMatchObject({ constraint: "packaging_generic_not_available" })
    })
    test("unreferenced materials can be reclassified without changing costs", async () => {
        const { rows } = await db.query(`INSERT INTO packagings(code,"displayName","packagingRole",classification,"unitCost") VALUES ('FREE','Free','unit','generic',3.1415) RETURNING id`)
        await db.query("UPDATE packagings SET classification='specific' WHERE id=$1", [rows[0].id])
        expect((await db.query('SELECT classification,"unitCost" FROM packagings WHERE id=$1', [rows[0].id])).rows[0]).toEqual({ classification: "specific", unitCost: "3.1415" })
    })
    test.each([true, false])("concurrent assignment/reclassification cannot create generic associations (assignment first=%s)", async assignmentFirst => {
        const { rows } = await db.query(`INSERT INTO packagings(code,"displayName","packagingRole") VALUES ($1,'Race','unit') RETURNING id`, [`RACE-${assignmentFirst}`])
        const id = rows[0].id
        const first = await connection(), second = await connection()
        const assign = (c: any) => c.query('INSERT INTO "productVariantUnitMaterials"("packagingId") VALUES ($1)', [id])
        const classify = (c: any) => c.query("UPDATE packagings SET classification='generic' WHERE id=$1", [id])
        try {
            await first.query("BEGIN")
            await (assignmentFirst ? assign(first) : classify(first))
            const pending = (assignmentFirst ? classify(second) : assign(second)).then(() => null, (error: any) => error)
            await first.query("COMMIT")
            expect(await pending).toMatchObject({ constraint: assignmentFirst ? "packaging_associations_protected" : "packaging_generic_not_available" })
        } finally {
            await first.query("ROLLBACK")
            await first.end(); await second.end()
        }
    })
})
