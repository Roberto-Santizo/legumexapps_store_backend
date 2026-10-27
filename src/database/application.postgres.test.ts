import fs from "node:fs"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
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
import { Sequelize } from "sequelize-typescript"
import { databaseModels } from "./models"
import { bootstrapDatabase } from "./bootstrap"

suite("complete application on an owned isolated PostgreSQL cluster (explicitly skipped without harness)", () => {
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
    let recoveryDirectory: string
    let existingJuice: any
    let existingPresentation: any

    function utility(name: string, args: string[], database?: string) {
        const { spawnSync } = require("node:child_process")
        const { safeEnvironment } = require("../../scripts/test-postgres.cjs")
        const url = new URL(process.env.TEST_DATABASE_URL!)
        const environment = { ...safeEnvironment(), PGHOST: "127.0.0.1", PGPORT: url.port, PGDATABASE: database ?? url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: "disable" }
        const result = spawnSync(path.join(process.env.LEGUMEX_TEST_POSTGRES_BIN!, name + (process.platform === "win32" ? ".exe" : "")), args, { env: environment, windowsHide: true, encoding: "utf8", timeout: 60000 })
        if (result.error || result.status !== 0) throw new Error(`Isolated ${name} failed; sensitive output suppressed`)
        return result.stdout as string
    }

    async function restoredDatabase(suffix: string, backup: string) {
        const { verifyOwnedPostgres } = await import("../shared/test-utils/ownedPostgres")
        await verifyOwnedPostgres(owner)
        const original = new URL(process.env.TEST_DATABASE_URL!)
        const id = original.username.match(/^test_owner_([a-f0-9]{32})$/)![1]
        if (suffix !== "recovery") throw new Error("Unsafe local recovery suffix")
        const database = `restore_${suffix}_${id}`
        await owner.query(`CREATE DATABASE "${database}"`)
        utility("pg_restore", ["--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "--dbname", database, backup], database)
        const client = new Client({host:"127.0.0.1", port:Number(original.port), user:decodeURIComponent(original.username), password:decodeURIComponent(original.password), database, ssl:false, connectionTimeoutMillis:5000})
        await client.connect()
        const identity = (await client.query("SELECT current_user,current_database(),current_setting('data_directory') AS directory,current_setting('port') AS port")).rows[0]
        if (identity.current_database !== database || identity.current_user !== original.username || fs.realpathSync(identity.directory) !== fs.realpathSync(process.env.LEGUMEX_TEST_CLUSTER_DIR!) || Number(identity.port) !== Number(original.port)) {
            await client.end(); throw new Error("Restored database escaped the owned cluster")
        }
        return client
    }

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
        const creator = new Sequelize(ownerUrl.href,{dialect:'postgres',logging:false,models:databaseModels,dialectOptions:{ssl:false}})
        try { await bootstrapDatabase(creator,credentials) } finally { await creator.close() }
        const client = (await owner.query(`INSERT INTO clients(name,"createdAt","updatedAt") VALUES ('Existing client',now(),now()) RETURNING id`)).rows[0]
        existingJuice = (await owner.query(`INSERT INTO juices(code,"displayName","urlSlug","clientId","createdAt","updatedAt") VALUES ('EXISTING-JUICE','Existing juice','existing-juice',$1,now(),now()) RETURNING *`, [client.id])).rows[0]
        existingPresentation = (await owner.query(`INSERT INTO "juicePresentations"("juiceId","displayLabel","mlPerBottle","bottlesPerCase","casesPerPallet","boxUnitCost","stickerUnitCost","stickerQuantityPerCase","secondStickerUnitCost","secondStickerQuantityPerCase","bottleUnitCost","capUnitCost","createdAt","updatedAt") VALUES ($1,'Existing 6x354',354,6,100,1,0,0,0,0,0.1,0.05,now(),now()) RETURNING *`, [existingJuice.id])).rows[0]
        await owner.query(`INSERT INTO packagings(code,"displayName","packagingRole","materialType","unitCost","createdAt","updatedAt") VALUES ('EXISTING-PACKAGING','Existing material','unit','INDIVIDUAL',0.1234,now(),now())`)
        const category=(await owner.query(`INSERT INTO categories("displayName","urlSlug","createdAt","updatedAt") VALUES ('Existing fixed','existing-fixed',now(),now()) RETURNING id`)).rows[0]
        const sub=(await owner.query(`INSERT INTO "subCategories"("categoryId","displayName","urlSlug","createdAt","updatedAt") VALUES ($1,'Existing sub','existing-sub',now(),now()) RETURNING id`,[category.id])).rows[0]
        const product=(await owner.query(`INSERT INTO products("subCategoryId","clientId","displayName","urlSlug","isOrganic","createdAt","updatedAt") VALUES ($1,$2,'Existing fixed product','existing-fixed-product',true,now(),now()) RETURNING id`,[sub.id,client.id])).rows[0]
        const size=(await owner.query(`INSERT INTO presentations("displayLabel","netWeightGrams","createdAt","updatedAt") VALUES ('Existing 100g',100,now(),now()) RETURNING id`)).rows[0]
        const variant=(await owner.query(`INSERT INTO "productVariants"("productId","presentationId","skuCode","boxesPerPallet","unitsPerBox","createdAt","updatedAt") VALUES ($1,$2,'EXISTING-FIXED',2,3,now(),now()) RETURNING id`,[product.id,size.id])).rows[0]
        await owner.query(`INSERT INTO "productVariantUnitMaterials"("productVariantId","packagingId","createdAt","updatedAt") SELECT $1,id,now(),now() FROM packagings WHERE code='EXISTING-PACKAGING'`,[variant.id])
        recoveryDirectory = path.join(path.dirname(process.env.LEGUMEX_TEST_CLUSTER_DIR!), "recovery-proof")
        fs.mkdirSync(recoveryDirectory)
        expect((await owner.query(`SELECT "unitCost"::text AS cost FROM packagings WHERE code='EXISTING-PACKAGING'`)).rows[0].cost).toBe("0.123400000000")
        // Only the current direct-cost juice contract is created.
        expect((await owner.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND (table_name='juices' AND column_name='pricePerPound' OR table_name='juicePresentations' AND column_name='marginPerCase')`)).rows).toEqual([])
        // Identifier is generated hex and checked above, never taken from arbitrary input.
        await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
        await owner.query(`GRANT USAGE ON SCHEMA public TO "${appUrl.username}"`)
        await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${appUrl.username}"`)
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

    async function rowFingerprint(client = owner): Promise<unknown[]> {
        const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        const fingerprints = []
        for (const row of rows as { tablename: string }[]) {
            const table = row.tablename.replace(/"/g, '""')
            const result = await client.query(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM public."${table}" t`)
            fingerprints.push({ table, ...result.rows[0] })
        }
        return fingerprints
    }

    test("initialized schema is ready and another bootstrap preserves every existing row", async () => {
        const { assertDatabaseReady } = await import("./schemaReadiness")
        await assertDatabaseReady(reader,sequelize)
        const before=await rowFingerprint()
        await expect(bootstrapDatabase(sequelize,credentials)).rejects.toThrow('empty database')
        expect(await rowFingerprint()).toEqual(before)
    },60000)

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
        const variant = await model("ProductVariant").create({ productId: product.id, presentationId: presentation.id, skuCode: "SYNTHETIC-SKU-001", usesPalletKit: false, boxesPerPallet: 2, bagsPerBox: 3, unitsPerIntermediatePackage: 2 })
        variantId = variant.id
        const pound = await model("Unit").findOne({ where: { unitCode: "pound" } })
        expect(Number(pound.baseFactor)).toBe(453.592)
        // Economic values in this test are deliberately synthetic: 453.592 USD/lb = 1 USD/g.
        const material = await model("RawMaterial").create({ code: "SYNTHETIC-MP-001", displayName: "Synthetic material", urlSlug: "synthetic-material", ingredientType: "other", costPerUnit: 453.592, costUnitId: pound.id })
        await model("ProductRawMaterial").create({ productId: product.id, rawMaterialId: material.id, percentage: 100 })
        const ingredient = await model("Ingredient").create({ code: "SYNTHETIC-ING-001", displayName: "Synthetic ingredient", urlSlug: "synthetic-ingredient", costPerUnit: 453.592, costUnitId: pound.id })
        await model("ProductIngredient").create({ productId: product.id, ingredientId: ingredient.id, grams: 1, referenceNetWeightGrams: 100 })
        const unit = await model("Packaging").create({ code: "SYNTHETIC-UNIT", displayName: "Synthetic unit", packagingRole: "unit", materialType: "INDIVIDUAL", unitCost: 0.25 })
        unitPackagingId = unit.id
        const intermediate = await model("Packaging").create({ code: "SYNTHETIC-INTERMEDIATE", displayName: "Synthetic intermediate", packagingRole: "intermediate", materialType: "INTERMEDIO", unitCost: 1.5 })
        const pallet = await model("Packaging").create({ code: "SYNTHETIC-PALLET", displayName: "Synthetic pallet", packagingRole: "pallet", materialType: "OTRO", unitCost: 5 })
        for (const [type, quantity] of [["TARIMA", 1], ["ESQUINERO", 4], ["STRETCH", 93.3]] as const) {
            const material = await model("Packaging").create({ code: `SYNTHETIC-KIT-${type}`, displayName: `Kit ${type}`, classification: "generic", packagingRole: "pallet", materialType: type, defaultQuantityBasis: "per_pallet", defaultQuantityValue: quantity, unitCost: 0 })
            await model("PalletKitMaterial").create({ packagingId: material.id })
        }
        const generic = await model("Packaging").create({ code: "SYNTHETIC-GENERIC", displayName: "Synthetic generic", classification: "generic", packagingRole: "unit", materialType: "INDIVIDUAL", unitCost: 1 })
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
        const input = { productVariantId: variant.id, requestedPallets: 2, draftKey: randomUUID(), order: { id: randomUUID(), clientName: client.name, clientId: client.id } }
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

        // Guardado desde el cotizador del admin: mismo cálculo, autor staff, cliente resuelto por el servidor.
        const adminSaved = await request(server).post("/api/admin/quotes").set("Authorization", `Bearer ${adminToken}`)
            .send({ productVariantId: variant.id, requestedPallets: 2, orderId: randomUUID() })
        expect(adminSaved.status).toBe(201)
        const adminQuote = await model("Quote").findByPk(adminSaved.body.data.id)
        expect(adminQuote).toMatchObject({ salespersonId: null, createdByUserId: (jwt.decode(adminToken) as unknown as { sub: number }).sub })
        expect(Number(adminQuote.totalCost)).toBe(1495.4)
        expect(adminQuote.breakdown.order).toMatchObject({ clientId: client.id, clientName: client.name })
        await expect(model("Quote").create({ ...adminQuote.get({ plain: true }), id: undefined, salespersonId: salesperson.id })).rejects.toThrow("quote_single_author")
        // Envío por correo desde el cotizador admin: cada envío se agrega a emailDeliveries (jsonb ||).
        const { emailService } = require("../shared/services/email.service") as { emailService: { sendMailWithAttachment: jest.Mock } }
        const sendEmail = (recipientName: string, to: string) => request(server).post("/api/admin/quotes/send-email").set("Authorization", `Bearer ${adminToken}`)
            .field("to", to).field("subject", "Quote").field("body", "Attached").field("recipientName", recipientName).field("quoteIds", JSON.stringify([adminQuote.id]))
            .attach("file", Buffer.from("%PDF-1.4"), { filename: "quote.pdf", contentType: "application/pdf" })
        expect((await model("Quote").findByPk(adminQuote.id)).emailDeliveries).toEqual([])
        emailService.sendMailWithAttachment.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        expect((await sendEmail("Synthetic buyer", "buyer@example.invalid")).status).toBe(200)
        expect((await sendEmail("Second buyer", "second@example.invalid")).status).toBe(200)
        // El tercero falla al enviar (mock por defecto): no se registra.
        expect((await sendEmail("Never sent", "never@example.invalid")).status).toBe(500)
        const deliveries = (await model("Quote").findByPk(adminQuote.id)).emailDeliveries
        expect(deliveries).toEqual([
            { recipientName: "Synthetic buyer", recipientEmail: "buyer@example.invalid", sentByUserId: adminQuote.createdByUserId, sentAt: expect.any(String) },
            expect.objectContaining({ recipientName: "Second buyer", recipientEmail: "second@example.invalid" }),
        ])
        expect((await model("Quote").findByPk(persisted.id)).emailDeliveries).toEqual([])
        const listed = await request(server).get("/api/admin/quotes").set("Authorization", `Bearer ${adminToken}`)
        expect(listed.body.data.find((row: { id: number }) => row.id === adminQuote.id)).toMatchObject({ quotingSalesperson: null, quotingUser: { id: adminQuote.createdByUserId }, emailDeliveries: deliveries })
        const dashboard = await request(server).get("/api/admin/dashboard/summary").set("Authorization", `Bearer ${adminToken}`)
        expect(dashboard.body.data.overview).toMatchObject({ totalQuotes: 2, uniqueSalespeople: 1 })
        expect(dashboard.body.data.topSalespeople).toEqual(expect.arrayContaining([expect.objectContaining({ isAdmin: true, quoteCount: 1 })]))
    }, 60000)

    test("concurrent generic creation assigns unique consecutive codes under the real advisory lock", async () => {
        const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => request(server).post("/api/packagings").set("Authorization", `Bearer ${adminToken}`).send({ displayName: `Concurrent generic ${i}`, displayNameEn: `Concurrent generic ${i}`, classification: "generic", packagingRole: "unit", unitCost: 1 })))
        for (const response of responses) expect(response.status).toBe(201)
        const numbers = responses.map(response => { expect(response.body.data.code).toMatch(/^GEN-IND-\d{4}$/); return Number(response.body.data.code.split("-").at(-1)) }).sort((a,b) => a-b)
        expect(new Set(numbers).size).toBe(5)
        expect(numbers).toEqual(Array.from({ length: 5 }, (_, i) => numbers[0] + i))
    }, 30000)

    test("fixed quotes cost the standard kit once and reject inactive assigned packaging", async () => {
        const model = (name: string) => sequelize.models[name] as any
        const sku = await model("ProductVariant").findByPk(variantId)
        const product = await model("Product").findByPk(sku.productId)
        const client = await model("Client").findByPk(product.clientId)
        const input = { productVariantId: variantId, requestedPallets: 2, order: { id: randomUUID(), clientId: client.id, clientName: client.name } }
        await sku.update({ usesPalletKit: true })
        try {
            await owner.query(`UPDATE packagings SET "unitCost"=1 WHERE code LIKE 'SYNTHETIC-KIT-%'`)
            const response = await request(server).post("/api/quotes/preview").set("Authorization", `Bearer ${representativeToken}`).send(input)
            expect(response.status).toBe(200)
            expect(response.body.data.palletMaterialCost).toBe(206.6)
            expect(response.body.data.totalCost).toBe(1711.66)
            expect(response.body.data.breakdown.palletMaterials).toHaveLength(4)
            await model("Packaging").update({ isActive: false }, { where: { id: unitPackagingId } })
            expect((await request(server).post("/api/quotes/preview").set("Authorization", `Bearer ${representativeToken}`).send(input)).status).toBe(422)
        } finally {
            await sku.update({ usesPalletKit: false })
            await model("Packaging").update({ isActive: true }, { where: { id: unitPackagingId } })
            await owner.query(`UPDATE packagings SET "unitCost"=0 WHERE code LIKE 'SYNTHETIC-KIT-%'`)
        }
    }, 30000)

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
        ["retired juice column", 'ALTER TABLE public.juices ADD COLUMN "pricePerPound" numeric NOT NULL DEFAULT 0'],
        ["missing cumulative trigger", 'ALTER TABLE public."genericPackagingConfigurationMaterials" DISABLE TRIGGER guard_generic_packaging_assignment'],
        ["missing column", 'ALTER TABLE public.packagings RENAME COLUMN "displayNameEn" TO "synthetic_missing_column"'],
        ["default drift", 'ALTER TABLE public.packagings ALTER COLUMN "isActive" SET DEFAULT false'],
        ["disabled trigger", 'ALTER TABLE public.packagings DISABLE TRIGGER guard_packaging_reclassification'],
        ["missing check", 'ALTER TABLE public.packagings DROP CONSTRAINT packagings_consumption_defaults_check'],
        ["weakened check", 'ALTER TABLE public.packagings DROP CONSTRAINT packaging_classification_valid; ALTER TABLE public.packagings ADD CONSTRAINT packaging_classification_valid CHECK(true)'],
        ["partial unique index", 'ALTER TABLE public.packagings DROP CONSTRAINT packagings_code_key; CREATE UNIQUE INDEX synthetic_partial_code ON public.packagings(code) WHERE false'],
        ["wrong trigger events", 'DROP TRIGGER guard_unit_packaging ON public."productVariantUnitMaterials"; CREATE TRIGGER guard_unit_packaging BEFORE DELETE ON public."productVariantUnitMaterials" FOR EACH ROW EXECUTE FUNCTION public.guard_packaging_assignment(\'unit\')'],
        ["foreign schema FK", 'CREATE SCHEMA synthetic_shadow; CREATE TABLE synthetic_shadow.clients (id integer PRIMARY KEY); INSERT INTO synthetic_shadow.clients SELECT id FROM public.clients; ALTER TABLE public.representative_clients DROP CONSTRAINT "representative_clients_clientId_fkey"; ALTER TABLE public.representative_clients ADD CONSTRAINT representative_clients_clientId_fkey FOREIGN KEY ("clientId") REFERENCES synthetic_shadow.clients(id) ON DELETE RESTRICT ON UPDATE CASCADE'],
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

    test("bootstrap never repairs permissions or changes rows in an existing database", async () => {
        await owner.query("UPDATE public.permissions SET \"isActive\"=false WHERE name='products:view'")
        const before = await rowFingerprint()
        try {
            await expect(bootstrapDatabase(sequelize, credentials)).rejects.toThrow()
            expect(await rowFingerprint()).toEqual(before)
        } finally { await owner.query("UPDATE public.permissions SET \"isActive\"=true WHERE name='products:view'") }
    })

    test("application role has no DDL rights and two startups perform inspection only without changing rows", async () => {
        await expect(reader.query('CREATE TABLE public.synthetic_unauthorized_ddl (id integer)')).rejects.toMatchObject({ code: "42501" })
        await expect(reader.query('ALTER TABLE public.packagings ADD COLUMN synthetic_unauthorized integer')).rejects.toMatchObject({ code: "42501" })
        await expect(reader.query("TRUNCATE public.users")).rejects.toMatchObject({ code: "42501" })
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

    test("explicit owner policy accepts a real schema owner and still starts without changing rows", async () => {
        const { env } = await import("../config/env")
        const configuration = env as unknown as { databaseRolePolicy?: "restricted" | "owner" }
        const username = new URL(process.env.TEST_APP_DATABASE_URL!).username
        const previousOwner = (await owner.query("SELECT pg_get_userbyid(nspowner) AS name FROM pg_namespace WHERE nspname='public'")).rows[0].name
        const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"'
        const before = await rowFingerprint()
        const exit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("Owner startup rejected") })
        try {
            await owner.query(`ALTER SCHEMA public OWNER TO ${quote(username)}`)
            await owner.query(`ALTER TABLE public.users OWNER TO ${quote(username)}`)
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
            await owner.query(`ALTER TABLE public.users OWNER TO ${quote(new URL(process.env.TEST_DATABASE_URL!).username)}`)
            // Ownership transfers remove explicit ACL entries; restore the fixture's original grants.
            await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.users TO ${quote(username)}`)
            await owner.query(`GRANT USAGE,SELECT ON SEQUENCE public.users_id_seq TO ${quote(username)}`)
            exit.mockRestore()
        }
    }, 60000)

    test("startup readiness rejects incomplete application DML privileges",async()=>{
        const {assertDatabaseReady}=await import('./schemaReadiness')
        const role='"'+new URL(process.env.TEST_APP_DATABASE_URL!).username+'"'
        await assertDatabaseReady(reader,sequelize)
        await owner.query(`REVOKE INSERT ON public.quotes FROM ${role}`)
        try{await expect(assertDatabaseReady(reader,sequelize)).rejects.toThrow('privileges incomplete')}
        finally{await owner.query(`GRANT INSERT ON public.quotes TO ${role}`)}
        await assertDatabaseReady(reader,sequelize)
    })

    test("generic administration, automatic cumulative costs and mandatory alternatives use real API and PostgreSQL", async () => {
        const model = (name: string) => sequelize.model(name) as any
        const category = await model("Category").create({ displayName: "Generic test category", urlSlug: "generic-test-category" })
        await model("CategoryTranslation").create({ categoryId: category.id, language: "en", displayName: "Translated category" })
        const options = await request(server).get("/api/generic-packaging-configurations/options").set("Authorization", `Bearer ${adminToken}`)
        expect(options.status).toBe(200)
        expect(options.body.data.categories.find((row: any) => row.id === category.id).translations).toEqual(expect.arrayContaining([expect.objectContaining({ language: "en", displayName: "Translated category" })]))
        const sub = await model("SubCategory").create({ categoryId: category.id, displayName: "Generic test subcategory", urlSlug: "generic-test-subcategory" })
        const presentation = await model("Presentation").create({ displayLabel: "Generic test 100g", netWeightGrams: 100 })
        const client = await model("Client").create({ name: "Generic pool source" })
        const product = await model("Product").create({ subCategoryId: sub.id, clientId: client.id, displayName: "Generic pool product", urlSlug: "generic-pool-product" })
        const pound = await model("Unit").findOne({ where: { unitCode: "pound" } })
        const raw = await model("RawMaterial").create({ code: "GENERIC-TEST-RAW", displayName: "Generic raw", urlSlug: "generic-test-raw", ingredientType: "other", costPerUnit: 1, costUnitId: pound.id })
        await model("ProductRawMaterial").create({ productId: product.id, rawMaterialId: raw.id, percentage: 100 })
        const group = await model("PackagingGroup").create({ displayName: "Generic pallets", nameKey: "generic pallets" })
        const bags = await model("PackagingGroup").create({ displayName: "Generic bags", nameKey: "generic bags" })
        const makeMaterial = async (role: string) => {
            const response = await request(server).post("/api/generic-packaging-configurations/materials").set("Authorization", `Bearer ${adminToken}`).send({ displayName: `Generic ${role}`, displayNameEn: `Generic ${role}`, classification: "generic", packagingRole: role, ...(role === "pallet" ? { materialType: "OTRO" } : {}), unitCost: 0.123456789123 })
            expect(response.status).toBe(201)
            expect(response.body.data.code).toMatch(/^GEN-/)
            return response.body.data.id
        }
        const pallet = await makeMaterial("pallet"), bag = await makeMaterial("unit")
        const body = { reference: "GENERIC-API-TEST", displayName: "Generic configuration", categoryId: category.id, presentationId: presentation.id, bagsPerBox: 5, boxesPerPallet: 60, unitsPerIntermediatePackage: null, isActive: true,
            groups: [{ packagingGroupId: group.id, level: "pallet", selectionMode: "all", isRequired: true, options: [{ packagingId: pallet, quantityBasis: "per_pallet", quantityValue: 93.3 }] }, { packagingGroupId: bags.id, level: "unit", selectionMode: "one", isRequired: true, options: [{ packagingId: bag, quantityBasis: "per_unit", quantityValue: 1 }] }] }
        const created = await request(server).post("/api/generic-packaging-configurations").set("Authorization", `Bearer ${adminToken}`).send(body)
        expect(created.status).toBe(201)
        const listing = await request(server).get("/api/generic-packaging-configurations").set("Authorization", `Bearer ${adminToken}`)
        expect(listing.status).toBe(200)
        const profile = listing.body.data.find((row: any) => row.id === created.body.data.id)
        expect(profile.ready).toBe(true)
        const bagGroup = profile.groups.find((g: any)=>g.level === "unit")
        const input = { configurationOrigin: "generic_configuration", categoryId: category.id, subCategoryId: sub.id, configurationId: profile.id, ingredientType: "other", requestedPallets: 2, rawMaterialMix: [{ rawMaterialId: raw.id, percentage: 100 }], packagingSelections: [{ groupId: bagGroup.id, optionIds: [bagGroup.options[0].id] }] }
        const preview = await request(server).post("/api/admin/quotes/catalog-preview").set("Authorization", `Bearer ${adminToken}`).send(input)
        expect(preview.status).toBe(200)
        expect(preview.body.data.snapshotVersion).toBe(3)
        expect(preview.body.data.palletMaterialCost).toBe(23.037)
        expect(preview.body.data.unitPackagingCost).toBe(74.0741)
        const missing = await request(server).post("/api/admin/quotes/catalog-preview").set("Authorization", `Bearer ${adminToken}`).send({ ...input, packagingSelections: [] })
        expect(missing.status).toBe(422)
        const injected = await request(server).post("/api/admin/quotes/catalog-preview").set("Authorization", `Bearer ${adminToken}`).send({ ...input, packagingSelections: [...input.packagingSelections, { groupId: profile.groups.find((g:any)=>g.level === "pallet").id, optionIds: [] }] })
        expect(injected.status).toBe(422)
        const materialBefore = await model("Packaging").findByPk(pallet)
        expect(Number(materialBefore.unitCost)).toBe(0.123456789123)
    }, 30000)

    test("juice create, presentation and recipe rows remain compatible after model initialization", async () => {
        const model = (name: string) => sequelize.model(name) as any
        const client = await model("Client").create({name:"Juice recovery client"})
        const created = await request(server).post("/api/admin/juices").set("Authorization",`Bearer ${adminToken}`).send({code:"RECOVERY-JUICE",displayName:"Recovery juice",clientId:client.id})
        expect(created.status).toBe(201)
        const physical = {juiceId:created.body.data.id,displayLabel:"Recovery 6x354",mlPerBottle:354,bottlesPerCase:6,casesPerPallet:100,boxUnitCost:1,stickerUnitCost:0,stickerQuantityPerCase:0,secondStickerUnitCost:0,secondStickerQuantityPerCase:0,bottleUnitCost:0.1,capUnitCost:0.05}
        const presentation = await request(server).post("/api/admin/juices/presentations").set("Authorization",`Bearer ${adminToken}`).send(physical)
        expect(presentation.status).toBe(201)
        const raw=await model("JuiceRawMaterial").create({code:"RECOVERY-JUICE-RAW",displayName:"Recovery juice raw",purchaseUnit:"LIBRA",yieldPoundsPerLiter:2,costPerUnit:1,costPerLiter:2})
        const mix=await model("JuiceMix").create({juiceId:created.body.data.id,rawMaterialId:raw.id,percentage:100})
        expect(Number(mix.percentage)).toBe(100)
        expect((await model("Juice").findByPk(existingJuice.id)).displayName).toBe(existingJuice.displayName)
        expect(Number((await model("JuicePresentation").findByPk(existingPresentation.id)).mlPerBottle)).toBe(354)
    },30000)

    test("bootstrap cannot erase existing quotes or change stored costs",async()=>{
        const before=await rowFingerprint()
        await expect(bootstrapDatabase(sequelize,credentials)).rejects.toThrow('empty database')
        expect(await rowFingerprint()).toEqual(before)
    })

    test("backup restores current fixed quotes, juices, generic configuration, sequences and readiness into a second database without deleting the source", async () => {
        const {assertDatabaseReady,assertApplicationRole}=await import("./schemaReadiness")
        const source=await rowFingerprint()
        const sequences=async(client:any)=>(await client.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows
        const originalSequences=await sequences(owner)
        const backup=path.join(recoveryDirectory,"current-state.dump")
        utility("pg_dump",["--format=custom","--no-owner","--no-acl","--file",backup])
        expect(utility("pg_restore",["--list",backup])).toContain("Format: CUSTOM")
        const bytes=fs.readFileSync(backup)
        expect(bytes.length).toBeGreaterThan(100)
        const sha256=createHash("sha256").update(bytes).digest("hex")
        fs.writeFileSync(backup+".sha256",sha256+"\n",{flag:"wx"})
        expect(createHash("sha256").update(fs.readFileSync(backup)).digest("hex")).toBe(sha256)
        const clone=await restoredDatabase("recovery",backup)
        let app:any
        try {
            expect(await rowFingerprint(clone)).toEqual(source)
            expect(await sequences(clone)).toEqual(originalSequences)
            await assertDatabaseReady(clone,sequelize)
            expect(await rowFingerprint(clone)).toEqual(source)
            const url=new URL(process.env.TEST_APP_DATABASE_URL!)
            if (!/^test_app_[a-f0-9]{32}$/.test(url.username)) throw new Error("Unsafe restored app role")
            await clone.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
            await clone.query(`GRANT USAGE ON SCHEMA public TO "${url.username}"`)
            await clone.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${url.username}"`)
            await clone.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "${url.username}"`)
            const database=(await clone.query("SELECT current_database() AS name")).rows[0].name
            app=new Client({host:"127.0.0.1",port:Number(url.port),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database,ssl:false})
            await app.connect();await app.query("BEGIN READ ONLY")
            await assertDatabaseReady(app,sequelize);await assertApplicationRole(app);await app.query("ROLLBACK")
            for (const table of ['quotes','juices','genericPackagingConfigurations','genericPackagingConfigurationMaterials']) {
                expect((await clone.query(`SELECT count(*)::int AS total FROM "${table}"`)).rows[0].total).toBeGreaterThan(0)
            }
        } finally {if(app)await app.end();await clone.end()}
        expect(await rowFingerprint()).toEqual(source)
    },60000)
})
