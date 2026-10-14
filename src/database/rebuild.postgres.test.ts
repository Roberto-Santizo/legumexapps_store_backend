import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import request from "supertest"
import ExcelJS from "exceljs"

// Only external cloud integrations are mocked. All PostgreSQL, models, middleware,
// authentication, imports and calculation/persistence paths below are real.
jest.mock("../shared/services/email.service", () => ({ emailService: { sendMailWithAttachment: jest.fn(() => { throw new Error("Cloud calls forbidden in isolated integration") }) } }))
jest.mock("../shared/services/s3.service", () => ({
    uploadImage: jest.fn(() => { throw new Error("Cloud calls forbidden in isolated integration") }),
    deleteImage: jest.fn(() => { throw new Error("Cloud calls forbidden in isolated integration") }),
}))
jest.mock("../config/env", () => ({ env: {
    nodeEnv: "test", databaseUrl: process.env.TEST_APP_DATABASE_URL ?? "postgresql://unused:unused@127.0.0.1:1/unused?sslmode=disable",
    dbSyncAlter: false, serverPort: 4000, frontendUrl: "http://localhost:5173",
    jwtSecret: "synthetic-isolated-integration-secret-only", jwtExpiresIn: "1h",
} }))

const isolated = process.env.LEGUMEX_ISOLATED_POSTGRES === "1"
    && !!process.env.LEGUMEX_TEST_CLUSTER_DIR && !!process.env.TEST_DATABASE_URL && !!process.env.TEST_APP_DATABASE_URL
const suite = isolated ? describe : describe.skip
const credentials = { username: "synthetic_admin", password: "Synthetic-only-test-password-2026" }
const { Client } = require("pg") as { Client: new (options: object) => any }
const { migrate } = require("../../scripts/migrate.cjs") as { migrate: (client: any) => Promise<void> }

suite("complete rebuild on an owned isolated PostgreSQL cluster (explicitly skipped without harness)", () => {
    let owner: any
    let reader: any
    let sequelize: typeof import("./connection").default
    let connectDB: typeof import("./connection").connectDB
    let server: typeof import("../server").default
    let adminToken: string
    let representativeToken: string
    let variantId: number
    let unitPackagingId: number
    let genericPackagingId: number

    beforeAll(async () => {
        const ownerUrl = new URL(process.env.TEST_DATABASE_URL!)
        const appUrl = new URL(process.env.TEST_APP_DATABASE_URL!)
        const id = ownerUrl.username.match(/^test_owner_([a-f0-9]{32})$/)?.[1]
        if (!id || ownerUrl.hostname !== "127.0.0.1" || ownerUrl.pathname !== `/legumex_test_${id}`
            || appUrl.hostname !== ownerUrl.hostname || appUrl.port !== ownerUrl.port || appUrl.pathname !== ownerUrl.pathname
            || appUrl.username !== `test_app_${id}` || ownerUrl.search !== "?sslmode=disable" || appUrl.search !== "?sslmode=disable") {
            throw new Error("Integration refused: URLs are not the generated isolated owner/application destination")
        }
        owner = new Client({ connectionString: ownerUrl.href, ssl: false, connectionTimeoutMillis: 5000 })
        await owner.connect()
        const identity = (await owner.query("SELECT current_user,current_database(),current_setting('data_directory') AS data_directory,current_setting('port') AS port")).rows[0]
        const expectedDirectory = fs.realpathSync(process.env.LEGUMEX_TEST_CLUSTER_DIR!)
        if (identity.current_user !== ownerUrl.username || identity.current_database !== ownerUrl.pathname.slice(1)
            || fs.realpathSync(identity.data_directory) !== expectedDirectory || Number(identity.port) !== Number(ownerUrl.port)) {
            throw new Error("Integration refused: live server identity differs from newly owned cluster")
        }
        const pid = fs.readFileSync(path.join(expectedDirectory, "postmaster.pid"), "utf8").split(/\r?\n/)
        if (fs.realpathSync(pid[1]) !== expectedDirectory || Number(pid[3]) !== Number(ownerUrl.port)) throw new Error("Owned server PID proof failed")
        const tables = await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
        if (tables.rows.length) throw new Error("Integration requires a completely empty owned database")
        await migrate(owner)
        // Identifier is generated hex and checked above, never taken from arbitrary input.
        await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
        await owner.query(`GRANT USAGE ON SCHEMA public TO "${appUrl.username}"`)
        await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${appUrl.username}"`)
        await owner.query(`REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.schema_migrations FROM "${appUrl.username}"`)
        await owner.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appUrl.username}"`)
        reader = new Client({ connectionString: appUrl.href, ssl: false, connectionTimeoutMillis: 5000 })
        await reader.connect()
        const connection = await import("./connection")
        sequelize = connection.default
        connectDB = connection.connectDB
        server = (await import("../server")).default
    }, 120000)

    afterAll(async () => {
        if (sequelize) await sequelize.close()
        if (reader) await reader.end()
        if (owner) await owner.end()
    })

    async function rowFingerprint(): Promise<unknown[]> {
        const { rows } = await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        const fingerprints = []
        for (const row of rows as { tablename: string }[]) {
            const table = row.tablename.replace(/"/g, '""')
            const result = await owner.query(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM public."${table}" t`)
            fingerprints.push({ table, ...result.rows[0] })
        }
        return fingerprints
    }

    test("empty database migrates fully; schema validation precedes explicit bootstrap; reruns preserve rows and hashes", async () => {
        const { assertSchemaReady, assertDatabaseReady } = await import("./schemaReadiness")
        const { bootstrapDatabase } = await import("./bootstrap")
        try { await assertSchemaReady(reader, sequelize) } catch (error) {
            console.info("Isolated schema CHECK definitions", (await owner.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.packagings'::regclass AND contype='c'")).rows)
            throw error
        }
        await expect(assertDatabaseReady(reader, sequelize)).rejects.toThrow()
        await bootstrapDatabase(owner, credentials)
        await assertDatabaseReady(reader, sequelize)
        const before = await rowFingerprint()
        await migrate(owner)
        await bootstrapDatabase(owner, credentials)
        expect(await rowFingerprint()).toEqual(before)
        await expect(bootstrapDatabase(owner, { ...credentials, password: "Different-synthetic-password-2026" })).rejects.toThrow()
        expect(await rowFingerprint()).toEqual(before)
        expect((await owner.query('SELECT count(*)::int AS count FROM public.schema_migrations')).rows[0].count).toBe(4)
    }, 60000)

    test("real administrator login authorizes catalogs and rejects missing tokens, wrong token type and missing permissions", async () => {
        const login = await request(server).post("/api/login").send(credentials)
        expect(login.status).toBe(200)
        adminToken = login.body.data.token
        expect(jwt.decode(adminToken)).toMatchObject({ type: "staff" })
        for (const route of ["/api/packagings", "/api/units"]) {
            expect((await request(server).get(route).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200)
            expect((await request(server).get(route)).status).toBe(401)
        }
        const restricted = jwt.sign({ sub: 1, type: "staff", permissions: [] }, "synthetic-isolated-integration-secret-only")
        const wrongType = jwt.sign({ sub: 1, type: "customer" }, "synthetic-isolated-integration-secret-only")
        expect((await request(server).get("/api/packagings").set("Authorization", `Bearer ${restricted}`)).status).toBe(403)
        expect((await request(server).get("/api/packagings").set("Authorization", `Bearer ${wrongType}`)).status).toBe(401)
        expect((await request(server).post("/api/login").send({ ...credentials, password: "incorrect-password" })).status).toBe(401)
        expect((await request(server).post("/api/login").send(credentials)).status).toBe(200)
    }, 60000)

    test("synthetic catalogs exercise real three-level packaging, ingredients, percentages, representative auth, drafts and quote persistence", async () => {
        const model = (name: string) => sequelize.models[name] as any
        const category = await model("Category").create({ displayName: "Synthetic category", urlSlug: "synthetic-category" })
        const subcategory = await model("SubCategory").create({ categoryId: category.id, displayName: "Synthetic subcategory", urlSlug: "synthetic-subcategory" })
        const client = await model("Client").create({ name: "Synthetic test client" })
        const product = await model("Product").create({ subCategoryId: subcategory.id, clientId: client.id, displayName: "Synthetic test product", urlSlug: "synthetic-product", additionalCostPerUnit: 0.5 })
        const presentation = await model("Presentation").create({ displayLabel: "Synthetic 100 g", netWeightGrams: 100 })
        const variant = await model("ProductVariant").create({ productId: product.id, presentationId: presentation.id, skuCode: "SYNTHETIC-SKU-001", boxesPerPallet: 2, bagsPerBox: 3, unitsPerIntermediatePackage: 2 })
        variantId = variant.id
        const pound = await model("Unit").findOne({ where: { unitCode: "pound" } })
        expect(Number(pound.baseFactor)).toBe(453.592)
        // Economic values in this test are deliberately synthetic: 453.592 USD/lb = 1 USD/g.
        const material = await model("RawMaterial").create({ code: "SYNTHETIC-MP-001", displayName: "Synthetic material", urlSlug: "synthetic-material", ingredientType: "other", costPerUnit: 453.592, costUnitId: pound.id })
        await model("ProductRawMaterial").create({ productId: product.id, rawMaterialId: material.id, percentage: 100 })
        const ingredient = await model("Ingredient").create({ code: "SYNTHETIC-ING-001", displayName: "Synthetic ingredient", urlSlug: "synthetic-ingredient", costPerUnit: 453.592, costUnitId: pound.id })
        await model("ProductIngredient").create({ productId: product.id, ingredientId: ingredient.id, grams: 1, referenceNetWeightGrams: 100 })
        const unit = await model("Packaging").create({ code: "SYNTHETIC-UNIT", displayName: "Synthetic unit", packagingRole: "unit", unitCost: 0.25 })
        unitPackagingId = unit.id
        const intermediate = await model("Packaging").create({ code: "SYNTHETIC-INTERMEDIATE", displayName: "Synthetic intermediate", packagingRole: "intermediate", unitCost: 1.5 })
        const pallet = await model("Packaging").create({ code: "SYNTHETIC-PALLET", displayName: "Synthetic pallet", packagingRole: "pallet", unitCost: 5 })
        const generic = await model("Packaging").create({ code: "SYNTHETIC-GENERIC", displayName: "Synthetic generic", classification: "generic", packagingRole: "unit", unitCost: 1 })
        genericPackagingId = generic.id
        await model("ProductVariantUnitMaterial").create({ productVariantId: variant.id, packagingId: unit.id, quantityPerUnit: 1 })
        await model("ProductVariantIntermediateMaterial").create({ productVariantId: variant.id, packagingId: intermediate.id })
        await model("ProductVariantPalletMaterial").create({ productVariantId: variant.id, packagingId: pallet.id, quantityValue: 1, quantityBasis: "per_pallet" })
        await model("ProcessingCost").create({ displayName: "Synthetic weight cost", value: 45.3592, calculationType: "per_weight" })
        await model("ProcessingCost").create({ displayName: "Synthetic percentage", value: 10, calculationType: "percentage" })
        const salesperson = await model("Salesperson").create({ name: "Synthetic representative", email: "synthetic-rep@example.invalid", password: await bcrypt.hash(credentials.password, 10) })
        await model("RepresentativeClient").create({ representativeId: salesperson.id, clientId: client.id })
        const login = await request(server).post("/api/salesperson-login").send({ email: salesperson.email, password: credentials.password })
        expect(login.status).toBe(200)
        representativeToken = login.body.data.token
        expect(jwt.decode(representativeToken)).toMatchObject({ type: "customer", sub: salesperson.id })
        expect((await request(server).get("/api/packagings").set("Authorization", `Bearer ${representativeToken}`)).status).toBe(401)
        expect((await request(server).get("/api/quotes/products").set("Authorization", `Bearer ${adminToken}`)).status).toBe(401)
        const input = { productVariantId: variant.id, requestedPallets: 2, draftKey: randomUUID() }
        const preview = await request(server).post("/api/quotes/preview").set("Authorization", `Bearer ${representativeToken}`).send(input)
        expect(preview.status).toBe(200)
        expect(preview.body.data).toMatchObject({ totalUnits: 12, rawMaterialCost: 1200, ingredientCost: 12, unitPackagingCost: 3, intermediatePackagingCost: 9, palletMaterialCost: 10, processingCostTotal: 120, percentageCostTotal: 135.4, adjustmentCost: 6, transportCost: 0, totalCost: 1495.4 })
        expect(await model("Quote").count()).toBe(0)
        expect(await model("QuoteDraft").count()).toBe(1)
        const saved = await request(server).post("/api/quotes").set("Authorization", `Bearer ${representativeToken}`).send(input)
        expect(saved.status).toBe(201)
        const persisted = await model("Quote").findByPk(saved.body.data.id)
        expect(Number(persisted.totalCost)).toBe(1495.4)
        expect(persisted.salespersonId).toBe(salesperson.id)
        expect(persisted.breakdown).toEqual(saved.body.data.breakdown)
        expect((await model("QuoteDraft").findOne()).status).toBe("converted")
        expect((await request(server).get("/api/admin/quotes").set("Authorization", `Bearer ${adminToken}`)).status).toBe(200)
    }, 60000)

    test("real database triggers reject generic associations, mismatched roles and changes of consumed materials", async () => {
        const insert = (packaging: number) => reader.query('INSERT INTO public."productVariantUnitMaterials" ("productVariantId","packagingId","createdAt","updatedAt") VALUES ($1,$2,NOW(),NOW())', [variantId, packaging])
        await expect(insert(genericPackagingId)).rejects.toMatchObject({ code: "23514" })
        const pallet = (await reader.query('SELECT id FROM public.packagings WHERE code=$1', ["SYNTHETIC-PALLET"])).rows[0].id
        await expect(insert(pallet)).rejects.toMatchObject({ code: "23514" })
        await expect(reader.query('UPDATE public.packagings SET classification=\'generic\' WHERE id=$1', [unitPackagingId])).rejects.toMatchObject({ code: "23514" })
        expect((await reader.query('SELECT classification FROM public.packagings WHERE id=$1', [unitPackagingId])).rows[0].classification).toBe("specific")
    })

    test("synthetic XLSX uploads persist through real import API and duplicate rejection creates no extra rows", async () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet("Synthetic materials")
        sheet.addRow(["code", "nombre", "tipo", "costo", "nombre ingles"])
        sheet.addRow(["SYNTHETIC-IMPORT-001", "Synthetic imported material", "other", 2.5, "Synthetic imported material EN"])
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
        const upload = () => request(server).post("/api/raw-materials/bulk-import").set("Authorization", `Bearer ${adminToken}`)
            .attach("file", buffer, { filename: "synthetic.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
        const imported = await upload()
        expect(imported.status).toBe(201)
        expect(imported.body.data.created).toBe(1)
        const row = (await reader.query('SELECT r."costPerUnit",u."baseFactor" FROM public."rawMaterials" r JOIN public.units u ON u.id=r."costUnitId" WHERE r.code=$1', ["SYNTHETIC-IMPORT-001"])).rows[0]
        expect(Number(row.costPerUnit)).toBe(2.5)
        expect(Number(row.baseFactor)).toBe(453.592)
        const before = await rowFingerprint()
        expect((await upload()).status).toBe(422)
        expect(await rowFingerprint()).toEqual(before)
    }, 60000)

    test.each([
        ["ledger checksum", "UPDATE public.schema_migrations SET checksum=repeat('0',64) WHERE version='202610110001_initial_schema.sql'"],
        ["missing column", 'ALTER TABLE public.packagings RENAME COLUMN "displayNameEn" TO "synthetic_missing_column"'],
        ["default drift", 'ALTER TABLE public.packagings ALTER COLUMN "isActive" SET DEFAULT false'],
        ["disabled trigger", 'ALTER TABLE public.packagings DISABLE TRIGGER guard_packaging_reclassification'],
        ["missing check", 'ALTER TABLE public.packagings DROP CONSTRAINT packagings_consumption_defaults_check'],
        ["weakened check", 'ALTER TABLE public.packagings DROP CONSTRAINT packaging_classification_valid; ALTER TABLE public.packagings ADD CONSTRAINT packaging_classification_valid CHECK(true)'],
        ["partial unique index", 'ALTER TABLE public.packagings DROP CONSTRAINT packagings_code_key; CREATE UNIQUE INDEX synthetic_partial_code ON public.packagings(code) WHERE false'],
        ["wrong trigger events", 'DROP TRIGGER guard_unit_packaging ON public."productVariantUnitMaterials"; CREATE TRIGGER guard_unit_packaging BEFORE DELETE ON public."productVariantUnitMaterials" FOR EACH ROW EXECUTE FUNCTION public.guard_packaging_assignment(\'unit\')'],
        ["foreign schema FK", 'CREATE SCHEMA synthetic_shadow; CREATE TABLE synthetic_shadow.clients (id integer PRIMARY KEY); INSERT INTO synthetic_shadow.clients SELECT id FROM public.clients; ALTER TABLE public.representative_clients DROP CONSTRAINT representative_clients_client_fk; ALTER TABLE public.representative_clients ADD CONSTRAINT representative_clients_client_fk FOREIGN KEY ("clientId") REFERENCES synthetic_shadow.clients(id) ON DELETE RESTRICT ON UPDATE CASCADE'],
    ])("schema readiness rejects %s and rollback restores the owned schema", async (_label, mutation) => {
        const { assertSchemaReady } = await import("./schemaReadiness")
        await owner.query("BEGIN")
        try {
            await owner.query(mutation)
            await expect(assertSchemaReady(owner, sequelize)).rejects.toThrow()
        } finally { await owner.query("ROLLBACK") }
        await assertSchemaReady(reader, sequelize)
    })

    test("changed trigger literals are detected without treating case-sensitive values as equivalent", async () => {
        const { assertSchemaReady } = await import("./schemaReadiness")
        await owner.query("BEGIN")
        try {
            const source = (await owner.query("SELECT pg_get_functiondef('public.guard_packaging_assignment()'::regprocedure) AS definition")).rows[0].definition
            await owner.query(source.replace("'generic'", "'GENERIC'"))
            await expect(assertSchemaReady(owner, sequelize)).rejects.toThrow()
        } finally { await owner.query("ROLLBACK") }
        await assertSchemaReady(reader, sequelize)
    })

    test("inconsistent permission blocks bootstrap and rolls back all attempted writes", async () => {
        const { bootstrapDatabase } = await import("./bootstrap")
        await owner.query("UPDATE public.permissions SET \"isActive\"=false WHERE name='products:view'")
        const before = await rowFingerprint()
        try {
            await expect(bootstrapDatabase(owner, credentials)).rejects.toThrow()
            expect(await rowFingerprint()).toEqual(before)
        } finally { await owner.query("UPDATE public.permissions SET \"isActive\"=true WHERE name='products:view'") }
    })

    test("application role has no DDL rights and two startups perform inspection only without changing rows", async () => {
        await expect(reader.query('CREATE TABLE public.synthetic_unauthorized_ddl (id integer)')).rejects.toMatchObject({ code: "42501" })
        await expect(reader.query('ALTER TABLE public.packagings ADD COLUMN synthetic_unauthorized integer')).rejects.toMatchObject({ code: "42501" })
        await expect(reader.query("UPDATE public.schema_migrations SET checksum='forbidden'")).rejects.toMatchObject({ code: "42501" })
        const before = await rowFingerprint()
        const queries: string[] = []
        const original = sequelize.options.logging
        sequelize.options.logging = (sql: string) => queries.push(sql)
        const sync = jest.spyOn(sequelize, "sync")
        const exit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("Startup failed in isolated integration") })
        try {
            await connectDB()
            await connectDB()
            expect((await request(server).get("/health/ready")).status).toBe(200)
            expect(exit).not.toHaveBeenCalled()
            expect(sync).not.toHaveBeenCalled()
            expect(queries.length).toBeGreaterThan(10)
            for (const sql of queries) expect(sql).not.toMatch(/\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|DROP)\s/i)
            expect(await rowFingerprint()).toEqual(before)
            const failure = jest.spyOn(sequelize, "query").mockRejectedValueOnce(new Error("synthetic credential detail must not be returned"))
            try {
                const response = await request(server).get("/health/ready")
                expect(response.status).toBe(503)
                expect(response.body).toEqual({ status: "unavailable" })
            } finally { failure.mockRestore() }
        } finally {
            sequelize.options.logging = original
            sync.mockRestore()
            exit.mockRestore()
        }
    }, 60000)

    test("explicit owner policy accepts a real schema/history owner and still starts without changing rows", async () => {
        const { env } = await import("../config/env")
        const configuration = env as unknown as { databaseRolePolicy?: "restricted" | "owner" }
        const username = new URL(process.env.TEST_APP_DATABASE_URL!).username
        const previousOwner = (await owner.query("SELECT pg_get_userbyid(nspowner) AS name FROM pg_namespace WHERE nspname='public'")).rows[0].name
        const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"'
        const before = await rowFingerprint()
        const exit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("Owner startup rejected") })
        try {
            await owner.query(`ALTER SCHEMA public OWNER TO ${quote(username)}`)
            await owner.query(`ALTER TABLE public.schema_migrations OWNER TO ${quote(username)}`)
            configuration.databaseRolePolicy = "restricted"
            await expect(connectDB()).rejects.toThrow("Owner startup rejected")
            exit.mockClear()
            configuration.databaseRolePolicy = "owner"
            await connectDB()
            await connectDB()
            expect(exit).not.toHaveBeenCalled()
            expect(await rowFingerprint()).toEqual(before)
            expect((await request(server).get("/health/ready")).status).toBe(200)
        } finally {
            configuration.databaseRolePolicy = "restricted"
            await owner.query(`ALTER SCHEMA public OWNER TO ${quote(previousOwner)}`)
            await owner.query(`ALTER TABLE public.schema_migrations OWNER TO ${quote(new URL(process.env.TEST_DATABASE_URL!).username)}`)
            exit.mockRestore()
        }
    }, 60000)

    test("the exact prepared public-schema rebuild SQL and full migration/bootstrap chain work on this owned isolated database", async () => {
        const { assertDatabaseReady } = await import("./schemaReadiness")
        const { bootstrapDatabase } = await import("./bootstrap")
        const sql = fs.readFileSync(path.resolve(__dirname, "../../scripts/rebuild-public.sql"), "utf8")
        const ownerUrl = new URL(process.env.TEST_DATABASE_URL!)
        const directory = path.join(path.dirname(process.env.LEGUMEX_TEST_CLUSTER_DIR!), "recovery-proof")
        fs.mkdirSync(directory)
        const backup = path.join(directory, "synthetic-backup.dump")
        const { spawnSync } = require("node:child_process")
        const { safeEnvironment } = require("../../scripts/test-postgres.cjs")
        const { archiveInfo } = require("../../scripts/production-release.cjs")
        const childEnv = { ...safeEnvironment(), PGHOST: ownerUrl.hostname, PGPORT: ownerUrl.port, PGDATABASE: ownerUrl.pathname.slice(1), PGUSER: ownerUrl.username, PGPASSWORD: decodeURIComponent(ownerUrl.password), PGSSLMODE: "disable" }
        const utility = (name: string, args: string[]) => {
            const result = spawnSync(path.join(process.env.LEGUMEX_TEST_POSTGRES_BIN!, name + (process.platform === "win32" ? ".exe" : "")), args, { env: childEnv, windowsHide: true, encoding: "utf8", timeout: 60000 })
            if (result.error || result.status !== 0) throw new Error("Isolated recovery utility failed; raw output suppressed")
            return result.stdout as string
        }
        const before = await rowFingerprint()
        utility("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", backup])
        expect(utility("pg_restore", ["--list", backup])).toContain("Format: CUSTOM")
        const archive = await archiveInfo(backup)
        expect(archive.bytes).toBeGreaterThan(100)
        expect(archive.sha256).toMatch(/^[a-f0-9]{64}$/)
        // The owned cluster identity was proven beforeAll. No production URL is accepted here.
        await owner.query("BEGIN")
        try {
            await owner.query(sql)
            await owner.query("COMMIT")
        } catch (error) { await owner.query("ROLLBACK"); throw error }
        expect((await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows).toHaveLength(0)
        // Prove recovery, not merely a readable table-of-contents. This is the
        // synthetic owned cluster; external production URLs never reach here.
        utility("pg_restore", ["--clean", "--if-exists", "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "--dbname", ownerUrl.pathname.slice(1), backup])
        expect(await rowFingerprint()).toEqual(before)
        await owner.query("BEGIN")
        try { await owner.query(sql); await owner.query("COMMIT") }
        catch (error) { await owner.query("ROLLBACK"); throw error }
        await migrate(owner)
        await bootstrapDatabase(owner, credentials)
        await assertDatabaseReady(owner, sequelize)
        expect((await owner.query('SELECT count(*)::int AS total FROM public.permissions')).rows[0].total).toBe(78)
    }, 60000)
})
