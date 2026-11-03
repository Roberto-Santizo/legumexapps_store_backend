import fs from "node:fs"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import request from "supertest"
import ExcelJS from "exceljs"

// Only external cloud integrations are mocked. All PostgreSQL, models, middleware,
// authentication, imports and calculation/persistence paths below are real.
jest.mock("../shared/services/email.service", () => ({ emailService: {
    sendMailWithAttachment: jest.fn(() => { throw new Error("Cloud calls forbidden in isolated integration") }),
    sendMail: jest.fn(() => { throw new Error("Cloud calls forbidden in isolated integration") }),
} }))
jest.mock("../shared/services/s3.service", () => ({
    uploadImage: jest.fn(() => { throw new Error("Cloud calls forbidden in isolated integration") }),
    deleteImage: jest.fn(() => { throw new Error("Cloud calls forbidden in isolated integration") }),
}))
jest.mock("../config/env", () => ({ env: {
    nodeEnv: "test", databaseUrl: process.env.TEST_APP_DATABASE_URL ?? "postgresql://unused:unused@127.0.0.1:1/unused?sslmode=disable",
    dbSyncAlter: false, serverPort: 4000, frontendUrl: "http://localhost:5173",
    jwtSecret: "synthetic-isolated-integration-secret-only", jwtExpiresIn: "1h",
    quoteReviewRecipients: ["review@example.invalid"],
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
        // The representative never receives an amount (management review); the engine's costs are kept
        // in the draft and in the saved quote below.
        expect(preview.body.data).toMatchObject({ totalUnits: 12 })
        expect(JSON.stringify(preview.body)).not.toMatch(/Cost|lineTotal|baseAmount/)
        expect(await model("Quote").count()).toBe(0)
        expect(await model("QuoteDraft").count()).toBe(1)
        expect(Number((await model("QuoteDraft").findOne()).totalCost)).toBe(1495.4)
        const saved = await request(server).post("/api/quotes").set("Authorization", `Bearer ${representativeToken}`).send(input)
        expect(saved.status).toBe(201)
        expect(JSON.stringify(saved.body)).not.toMatch(/Cost|lineTotal|baseAmount/)
        const persisted = await model("Quote").findByPk(saved.body.data.id)
        expect(persisted).toMatchObject({ rawMaterialCost: "1200.0000", ingredientCost: "12.0000", unitPackagingCost: "3.0000", intermediatePackagingCost: "9.0000", palletMaterialCost: "10.0000", processingCostTotal: "120.0000", percentageCostTotal: "135.4000", adjustmentCost: "6.0000", transportCost: "0.0000" })
        expect(Number(persisted.totalCost)).toBe(1495.4)
        expect(persisted.salespersonId).toBe(salesperson.id)
        // What the representative saw is the same snapshot without its amounts.
        expect(persisted.breakdown).toMatchObject(saved.body.data.breakdown)
        expect((await model("QuoteDraft").findOne()).status).toBe("converted")
        // Sin aprobación gerencial no aparece en el listado de cotizaciones.
        const unapproved = await request(server).get("/api/admin/quotes").set("Authorization", `Bearer ${adminToken}`)
        expect(unapproved.status).toBe(200)
        expect(unapproved.body.data.some((row: { id: number }) => row.id === persisted.id)).toBe(false)

        // Guardado desde el cotizador del admin: mismo cálculo, autor staff, cliente resuelto por el servidor.
        const adminOrderId = randomUUID()
        const adminSaved = await request(server).post("/api/admin/quotes").set("Authorization", `Bearer ${adminToken}`)
            .send({ productVariantId: variant.id, requestedPallets: 2, orderId: adminOrderId })
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
        expect((await request(server).put(`/api/admin/quote-reviews/${adminOrderId}/admin-pricing`).set("Authorization", `Bearer ${adminToken}`).send({ profitPerPound: 0.5 })).status).toBe(200)
        const listed = await request(server).get("/api/admin/quotes").set("Authorization", `Bearer ${adminToken}`)
        expect(listed.body.data.map((row: { id: number }) => row.id)).toEqual([adminQuote.id])
        expect(listed.body.data[0]).toMatchObject({ quotingSalesperson: null, quotingUser: { id: adminQuote.createdByUserId }, emailDeliveries: deliveries, profit: { profitPerPound: 0.5, finalPrice: expect.any(Number) } })
        expect(listed.body.data[0].profit.finalPrice).toBeCloseTo(1495.4 + listed.body.data[0].profit.profitTotal, 2)
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
            expect(response.body.data.breakdown.palletMaterials).toHaveLength(4)
            expect(response.body.data).not.toHaveProperty("totalCost")
            // Same engine, staff view with amounts: the kit is costed once.
            const { order: _order, ...calculation } = input
            const internal = await request(server).post("/api/admin/quotes/preview").set("Authorization", `Bearer ${adminToken}`).send(calculation)
            expect(internal.status).toBe(200)
            expect(internal.body.data.palletMaterialCost).toBe(206.6)
            expect(internal.body.data.totalCost).toBe(1711.66)
            expect(internal.body.data.breakdown.palletMaterials).toHaveLength(4)
            await model("Packaging").update({ isActive: false }, { where: { id: unitPackagingId } })
            expect((await request(server).post("/api/quotes/preview").set("Authorization", `Bearer ${representativeToken}`).send(input)).status).toBe(422)
        } finally {
            await sku.update({ usesPalletKit: false })
            await model("Packaging").update({ isActive: true }, { where: { id: unitPackagingId } })
            await owner.query(`UPDATE packagings SET "unitCost"=0 WHERE code LIKE 'SYNTHETIC-KIT-%'`)
        }
    }, 30000)

    test("management review: the client email is optional; approving never sends by itself; sending only to the representative leaves the client out; prices reach the representative only once delivery is authorized", async () => {
        const model = (name: string) => sequelize.models[name] as any
        const { emailService } = require("../shared/services/email.service") as { emailService: { sendMail: jest.Mock; sendMailWithAttachment: jest.Mock } }
        const { buildProfitLine } = require("../features/pricing/services/quoteProfit") as typeof import("../features/pricing/services/quoteProfit")
        const rep = { Authorization: `Bearer ${representativeToken}` }, admin = { Authorization: `Bearer ${adminToken}` }
        const sku = await model("ProductVariant").findByPk(variantId)
        const client = await model("Client").findByPk((await model("Product").findByPk(sku.productId)).clientId)
        const orderId = randomUUID()
        const input = { productVariantId: variantId, requestedPallets: 2, order: { id: orderId, clientId: client.id, clientName: client.name } }
        const saved = await request(server).post("/api/quotes").set(rep).send(input)
        expect(saved.status).toBe(201)
        const quote = await model("Quote").findByPk(saved.body.data.id)
        const representative = await model("Salesperson").findByPk(quote.salespersonId)
        const reviews = () => model("QuoteOrderReview").findAll({ where: { orderId } })
        const submit = (body: object = {}) => request(server).post(`/api/quote-reviews/${orderId}`).set(rep).send(body)
        await client.update({ email: null })

        // The representative never reaches management routes, nor a direct send route.
        expect((await request(server).get(`/api/admin/quote-reviews/${orderId}`).set(rep)).status).toBe(401)
        expect((await request(server).post(`/api/quote-reviews/${orderId}/approve`).set(rep).send({})).status).toBe(404)
        expect((await request(server).post("/api/quotes/send-email").set(rep).field("to", "x@cliente.example").field("subject", "s").field("body", "b")
            .attach("file", Buffer.from("%PDF-1.4"), { filename: "c.pdf", contentType: "application/pdf" })).status).toBe(404)
        emailService.sendMail.mockReset().mockResolvedValue(undefined)
        emailService.sendMailWithAttachment.mockReset().mockResolvedValue(undefined)
        expect((await submit({ clientEmail: "no-es-correo" })).status).toBe(400)
        // Without the client's email the order still reaches management; nothing invented.
        const submitted = await submit()
        expect(submitted.status).toBe(201)
        expect(submitted.body.data).toMatchObject({ orderId, status: "pending", clientEmail: null, deliveryStatus: "pending", deliveryRecipients: null })
        expect(submitted.body.data).not.toHaveProperty("finalPrice")
        expect((await client.reload()).email).toBeNull()
        expect(emailService.sendMail).toHaveBeenCalledTimes(1)
        const [mail] = emailService.sendMail.mock.calls[0]
        expect(mail.to).toEqual(["review@example.invalid"])
        expect(mail.textBody).toContain(`http://localhost:5173/admin/quote-reviews/${orderId}`)
        expect(`${mail.subject} ${mail.textBody}`).not.toMatch(/\$|USD|\d+\.\d{2}/)
        // Adding the email later keeps the current behaviour (saved to the client with none); leaving the
        // field empty afterwards never erases it. Neither change notifies management again.
        expect((await submit({ clientEmail: "Compras@Cliente.example " })).body.data.clientEmail).toBe("compras@cliente.example")
        expect((await client.reload()).email).toBe("compras@cliente.example")
        expect((await submit()).body.data.clientEmail).toBe("compras@cliente.example")
        expect(emailService.sendMail).toHaveBeenCalledTimes(1)
        expect(await reviews()).toHaveLength(1)
        expect((await reviews())[0]).toMatchObject({ status: "pending", notificationStatus: "sent", notificationAttempts: 1, salespersonId: quote.salespersonId, clientName: client.name })

        const detail = await request(server).get(`/api/admin/quote-reviews/${orderId}`).set(admin)
        expect(detail.status).toBe(200)
        expect(detail.body.data).toMatchObject({ deliveryAvailable: false, suggestedClientEmail: "compras@cliente.example" })
        expect(detail.body.data.lines[0]).toMatchObject({ kind: "fixed", id: quote.id, totalCost: quote.totalCost })
        const expected = buildProfitLine({ totalCost: quote.totalCost, netWeightGrams: quote.breakdown.production.netWeightGrams, totalUnits: quote.totalUnits }, "0.25")
        const preview = await request(server).post(`/api/admin/quote-reviews/${orderId}/preview`).set(admin).send({ profitPerPound: "0.25" })
        expect(preview.status).toBe(200)
        expect(preview.body.data).toMatchObject({ profitPerPound: 0.25, finalPrice: expected.finalPrice, lines: [{ quoteId: quote.id, ...expected }] })
        // The preview carries the digest of the lines it calculated: the approval sends that one.
        expect(preview.body.data.linesDigest).toBe(detail.body.data.linesDigest)
        expect((await request(server).post(`/api/admin/quote-reviews/${orderId}/preview`).set(admin).send({ profitPerPound: 25 })).status).toBe(422)

        // Approval needs the digest of the lines management saw and an explicit delivery decision.
        const pdf = [Buffer.from("%PDF-1.4 synthetic"), { filename: "Cotizacion.pdf", contentType: "application/pdf" }] as const
        const approve = (body: Record<string, string>, withPdf: boolean) => {
            const call = request(server).post(`/api/admin/quote-reviews/${orderId}/approve`).set(admin)
            for (const [key, value] of Object.entries(body)) call.field(key, value)
            return withPdf ? call.attach("file", ...pdf) : call
        }
        const approval = { profitPerPound: "0.25", linesDigest: detail.body.data.linesDigest, delivery: "representative" }
        expect((await approve({ ...approval, linesDigest: "0".repeat(64) }, true)).status).toBe(409)
        expect((await approve(approval, false)).status).toBe(422) // Sending needs the final PDF.
        expect((await approve({ ...approval, delivery: "none" }, true)).status).toBe(422) // Not sending takes no PDF.
        expect((await reviews())[0].status).toBe("pending")
        expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
        const approved = await approve(approval, true)
        expect(approved.status).toBe(200)
        expect(approved.body.data.review).toMatchObject({ status: "approved", deliveryStatus: "sent", deliveryRecipients: "representative" })
        expect(approved.body.data).not.toHaveProperty("representativeNotified")
        // Only the representative (email from their record), never the client, not even in copy.
        expect(emailService.sendMailWithAttachment).toHaveBeenCalledTimes(1)
        const [deliveryMail] = emailService.sendMailWithAttachment.mock.calls[0]
        expect(deliveryMail).toMatchObject({ to: representative.email, cc: [], attachment: { fileName: "Cotizacion.pdf", contentType: "application/pdf" } })
        expect(JSON.stringify(deliveryMail)).not.toContain("compras@cliente.example")
        expect(emailService.sendMail).toHaveBeenCalledTimes(1) // The delivery is the notice: no extra one.
        // A retried approval neither changes anything nor sends twice; another approval is rejected.
        expect((await approve(approval, true)).status).toBe(200)
        expect(emailService.sendMailWithAttachment).toHaveBeenCalledTimes(1)
        expect((await approve({ ...approval, profitPerPound: "0.5" }, true)).status).toBe(409)
        // One successful delivery per order; an approved order cannot be rejected.
        expect((await request(server).post(`/api/admin/quote-reviews/${orderId}/delivery`).set(admin).field("recipients", "representative_and_client").attach("file", ...pdf)).status).toBe(409)
        expect((await request(server).post(`/api/admin/quote-reviews/${orderId}/reject`).set(admin).send({ reason: "Rentabilidad insuficiente" })).status).toBe(409)
        const [review] = await reviews()
        expect(review).toMatchObject({ status: "approved", profitPerPound: "0.2500", deliveryStatus: "sent", rejectionReason: null, reviewedByUserId: (jwt.decode(adminToken) as unknown as { sub: number }).sub })
        expect(review.deliveredAt).toBeInstanceOf(Date)
        expect(review.pricing).toMatchObject({ finalPrice: expected.finalPrice, profitTotal: expected.profitTotal })
        // The reviewed cost stays frozen: the profit lives only in the review.
        expect((await quote.reload()).totalCost).toBe(String(quote.totalCost))

        // Delivery authorized: the representative sees the final price only, never the cost or the profit.
        const status = await request(server).get(`/api/quote-reviews/${orderId}`).set(rep)
        expect(status.status).toBe(200)
        expect(status.body.data).toMatchObject({ status: "approved", deliveryStatus: "sent", deliveryRecipients: "representative", finalPrice: expected.finalPrice, lines: [{ quoteId: quote.id, finalPrice: expected.finalPrice }] })
        expect(JSON.stringify(status.body)).not.toMatch(/Cost|profit/i)
        // An approved order cannot change: a new line is rejected before it is stored (another order is needed).
        const linesBefore = await model("Quote").count({ where: { salespersonId: quote.salespersonId } })
        expect((await request(server).post("/api/quotes").set(rep).send(input)).status).toBe(409)
        expect(await model("Quote").count({ where: { salespersonId: quote.salespersonId } })).toBe(linesBefore)
        expect((await submit()).status).toBe(201)
        expect((await reviews())[0].status).toBe("approved")
        // The representative's destinations carry no transport cost.
        const destinations = await request(server).get("/api/quotes/destinations").set(rep)
        expect(destinations.status).toBe(200)
        expect(JSON.stringify(destinations.body)).not.toMatch(/baseCost/)
    }, 60000)

    test("management review: approving without sending only tells the representative (no PDF, no prices); management sends later with a copy to a client email it enters; failures keep the approval; admin orders set their own profit", async () => {
        const model = (name: string) => sequelize.models[name] as any
        const { emailService } = require("../shared/services/email.service") as { emailService: { sendMail: jest.Mock; sendMailWithAttachment: jest.Mock } }
        const rep = { Authorization: `Bearer ${representativeToken}` }, admin = { Authorization: `Bearer ${adminToken}` }
        const sku = await model("ProductVariant").findByPk(variantId)
        const client = await model("Client").findByPk((await model("Product").findByPk(sku.productId)).clientId)
        const orderId = randomUUID()
        const saved = await request(server).post("/api/quotes").set(rep).send({ productVariantId: variantId, requestedPallets: 1, order: { id: orderId, clientId: client.id, clientName: client.name } })
        expect(saved.status).toBe(201)
        const representative = await model("Salesperson").findByPk((await model("Quote").findByPk(saved.body.data.id)).salespersonId)
        await client.update({ email: "saved@cliente.example" })
        emailService.sendMail.mockReset().mockRejectedValueOnce(new Error("Graph 503")).mockResolvedValue(undefined)
        emailService.sendMailWithAttachment.mockReset().mockResolvedValue(undefined)
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {})
        try {
            expect((await request(server).post(`/api/quote-reviews/${orderId}`).set(rep).send({ clientEmail: "other@cliente.example" })).status).toBe(201)
        } finally { consoleError.mockRestore() }
        expect((await client.reload()).email).toBe("saved@cliente.example")
        expect(await model("QuoteOrderReview").findOne({ where: { orderId } })).toMatchObject({ status: "pending", notificationStatus: "failed", notificationAttempts: 1 })
        const resent = await request(server).post(`/api/admin/quote-reviews/${orderId}/notify`).set(admin)
        expect(resent.status).toBe(200)
        expect(resent.body.data.notificationStatus).toBe("sent")
        expect(emailService.sendMail).toHaveBeenCalledTimes(2)

        // Approve without sending: approved with its final price, the representative gets an internal notice.
        const pdf = () => [Buffer.from("%PDF-1.4 synthetic"), { filename: "Cotizacion.pdf", contentType: "application/pdf" }] as const
        const linesDigest = (await request(server).get(`/api/admin/quote-reviews/${orderId}`).set(admin)).body.data.linesDigest
        const deliver = (recipients: string, clientEmail?: string) => {
            const call = request(server).post(`/api/admin/quote-reviews/${orderId}/delivery`).set(admin).field("recipients", recipients)
            if (clientEmail !== undefined) call.field("clientEmail", clientEmail)
            return call.attach("file", ...pdf())
        }
        expect((await deliver("representative")).status).toBe(409) // Not approved yet.
        const approveWithoutSending = () => request(server).post(`/api/admin/quote-reviews/${orderId}/approve`).set(admin).send({ profitPerPound: "0.1", linesDigest, delivery: "none" })
        const approved = await approveWithoutSending()
        expect(approved.status).toBe(200)
        expect(approved.body.data).toMatchObject({ representativeNotified: true, deliveryAvailable: true, review: { status: "approved", deliveryStatus: "pending", deliveryRecipients: null } })
        expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
        expect(emailService.sendMail).toHaveBeenCalledTimes(3)
        const notice = emailService.sendMail.mock.calls[2][0]
        expect(notice.to).toBe(representative.email)
        expect(notice).not.toHaveProperty("cc")
        expect(`${notice.subject} ${notice.textBody}`).toContain(client.name)
        expect(`${notice.subject} ${notice.textBody}`).not.toMatch(/\$|USD|\d+\.\d{2}|cliente\.example/)
        // A retried approval does not notify again; nothing was released to the representative yet.
        expect((await approveWithoutSending()).body.data).not.toHaveProperty("representativeNotified")
        expect(emailService.sendMail).toHaveBeenCalledTimes(3)
        const pendingDelivery = (await request(server).get(`/api/quote-reviews/${orderId}`).set(rep)).body.data
        expect(pendingDelivery).toMatchObject({ status: "approved", deliveryStatus: "pending", deliveryRecipients: null })
        expect(pendingDelivery).not.toHaveProperty("finalPrice")

        // Later, management sends it with a copy to the client, entering a new email. Unknown recipients,
        // invalid emails and a copy without email are rejected before anything is reserved.
        expect((await deliver("client")).status).toBe(400)
        expect((await deliver("representative_and_client", "no-es-correo")).status).toBe(400)
        await model("QuoteOrderReview").update({ clientEmail: null }, { where: { orderId } })
        await client.update({ email: null })
        expect((await deliver("representative_and_client")).status).toBe(422)
        expect(await model("QuoteOrderReview").findOne({ where: { orderId } })).toMatchObject({ deliveryStatus: "pending", deliveryRecipients: null })
        await client.update({ email: "saved@cliente.example" })
        // The send fails: the approval stands, the email stays on this order only (the client already had one).
        emailService.sendMailWithAttachment.mockReset().mockRejectedValueOnce(new Error("Graph 503")).mockResolvedValue(undefined)
        const clientError = jest.spyOn(console, "error").mockImplementation(() => {})
        try {
            const failed = await deliver("representative_and_client", "Nueva@Cliente.example")
            expect(failed.status).toBe(200)
            expect(failed.body.data.deliveryStatus).toBe("failed")
        } finally { clientError.mockRestore() }
        expect(await model("QuoteOrderReview").findOne({ where: { orderId } })).toMatchObject({ status: "approved", deliveryStatus: "failed", deliveryRecipients: "representative_and_client", clientEmail: "nueva@cliente.example" })
        expect((await client.reload()).email).toBe("saved@cliente.example")
        // Delivery authorized (even if it failed): the representative now sees the final price.
        expect((await request(server).get(`/api/quote-reviews/${orderId}`).set(rep)).body.data).toMatchObject({ status: "approved", deliveryStatus: "failed", finalPrice: expect.any(Number) })
        // Two simultaneous retries: only one claims the delivery; to the representative, client in copy.
        const sendsBefore = emailService.sendMailWithAttachment.mock.calls.length
        const retries = await Promise.all([0, 1].map(() => deliver("representative_and_client")))
        expect(retries.map(response => response.status).sort()).toEqual([200, 409])
        expect(emailService.sendMailWithAttachment.mock.calls.length - sendsBefore).toBe(1)
        expect(retries.find(response => response.status === 200)!.body.data.deliveryStatus).toBe("sent")
        expect(emailService.sendMailWithAttachment).toHaveBeenLastCalledWith(expect.objectContaining({ to: representative.email, cc: ["nueva@cliente.example"] }))
        expect((await deliver("representative")).status).toBe(409)
        // A delivery stuck in "sending" (process died) is retried after 10 minutes, even with the same data:
        // the claim always renews its mark, so a second retry does not send again while the first is in
        // flight, and a late process from the expired attempt cannot overwrite the new attempt's result.
        await model("QuoteOrderReview").update({ deliveryStatus: "sending" }, { where: { orderId } })
        await sequelize.query(`UPDATE "quoteOrderReviews" SET "updatedAt" = date_trunc('milliseconds', now() - interval '11 minutes') WHERE "orderId" = :orderId`, { replacements: { orderId } })
        const expired = await model("QuoteOrderReview").findOne({ where: { orderId } })
        let release!: () => void
        emailService.sendMailWithAttachment.mockReset()
            .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
            .mockRejectedValueOnce(new Error("Graph timeout"))
        const renewed = deliver("representative_and_client").then(response => response)
        while (!emailService.sendMailWithAttachment.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 10))
        expect((await deliver("representative_and_client")).status).toBe(409)
        const { sendQuoteDelivery } = require("../features/quoteReview/services/quoteReviewDelivery")
        const lateError = jest.spyOn(console, "error").mockImplementation(() => {})
        try {
            expect(await sendQuoteDelivery(expired, { buffer: Buffer.from("%PDF-1.4"), fileName: "late.pdf" }, (key: string) => key)).toBe("failed")
        } finally { lateError.mockRestore() }
        expect(await model("QuoteOrderReview").findOne({ where: { orderId } })).toMatchObject({ deliveryStatus: "sending" })
        release()
        expect((await renewed).body.data.deliveryStatus).toBe("sent")
        expect(emailService.sendMailWithAttachment).toHaveBeenCalledTimes(2)
        expect(await model("QuoteOrderReview").findOne({ where: { orderId } })).toMatchObject({ deliveryStatus: "sent" })
        // An unknown order is not found for either side.
        expect((await request(server).post(`/api/quote-reviews/${randomUUID()}`).set(rep).send({ clientEmail: "x@cliente.example" })).status).toBe(404)
        // A representative's order cannot get an admin price that skips the review.
        expect((await request(server).put(`/api/admin/quote-reviews/${orderId}/admin-pricing`).set(admin).send({ profitPerPound: 0.5 })).status).toBe(404)
        await client.update({ email: null })

        const adminOrderId = randomUUID()
        expect((await request(server).post("/api/admin/quotes").set(admin).send({ productVariantId: variantId, requestedPallets: 2, orderId: adminOrderId })).status).toBe(201)
        const priced = await request(server).put(`/api/admin/quote-reviews/${adminOrderId}/admin-pricing`).set(admin).send({ profitPerPound: 0.5 })
        expect(priced.status).toBe(200)
        expect(priced.body.data).toMatchObject({ profitPerPound: 0.5, lines: [expect.objectContaining({ kind: "fixed" })] })
        expect(await model("QuoteOrderReview").findOne({ where: { orderId: adminOrderId } })).toMatchObject({ status: "approved", salespersonId: null, notificationStatus: "not_required", deliveryStatus: "not_required", clientEmail: null })
        // The admin's own order is sent from its calculator, never through the management delivery.
        expect((await request(server).post(`/api/admin/quote-reviews/${adminOrderId}/delivery`).set(admin).field("recipients", "representative").attach("file", ...pdf())).status).toBe(409)
        // The admin can change their own profit while building the order.
        expect((await request(server).put(`/api/admin/quote-reviews/${adminOrderId}/admin-pricing`).set(admin).send({ profitPerPound: 0 })).body.data.profitTotal).toBe(0)
        expect(emailService.sendMail).toHaveBeenCalledTimes(3)
    }, 60000)

    test("management review: a rejection needs a reason, tells only the representative why, sends nothing commercial and closes the order", async () => {
        const model = (name: string) => sequelize.models[name] as any
        const { emailService } = require("../shared/services/email.service") as { emailService: { sendMail: jest.Mock; sendMailWithAttachment: jest.Mock } }
        const rep = { Authorization: `Bearer ${representativeToken}` }, admin = { Authorization: `Bearer ${adminToken}` }
        const sku = await model("ProductVariant").findByPk(variantId)
        const client = await model("Client").findByPk((await model("Product").findByPk(sku.productId)).clientId)
        const orderId = randomUUID()
        const input = { productVariantId: variantId, requestedPallets: 1, order: { id: orderId, clientId: client.id, clientName: client.name } }
        const saved = await request(server).post("/api/quotes").set(rep).send(input)
        expect(saved.status).toBe(201)
        const representative = await model("Salesperson").findByPk((await model("Quote").findByPk(saved.body.data.id)).salespersonId)
        emailService.sendMail.mockReset().mockResolvedValue(undefined)
        emailService.sendMailWithAttachment.mockReset().mockResolvedValue(undefined)
        expect((await request(server).post(`/api/quote-reviews/${orderId}`).set(rep).send({ clientEmail: "compras@cliente.example" })).status).toBe(201)
        const reject = (reason?: string) => request(server).post(`/api/admin/quote-reviews/${orderId}/reject`).set(admin).send(reason === undefined ? {} : { reason })
        expect((await reject()).status).toBe(400)
        expect((await reject("  ")).status).toBe(400)
        // The representative cannot reject (or approve) through the API.
        expect((await request(server).post(`/api/admin/quote-reviews/${orderId}/reject`).set(rep).send({ reason: "No contamos con el producto" })).status).toBe(401)

        // The notice fails: the rejection is kept anyway and management is told the representative was not notified.
        emailService.sendMail.mockReset().mockRejectedValueOnce(new Error("Graph 503")).mockResolvedValue(undefined)
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {})
        let rejected: request.Response
        try { rejected = await reject("No contamos con el producto solicitado") } finally { consoleError.mockRestore() }
        expect(rejected.status).toBe(200)
        expect(rejected.body.data).toMatchObject({ representativeNotified: false, deliveryAvailable: false, review: { status: "rejected", rejectionReason: "No contamos con el producto solicitado", profitPerPound: null, pricing: null } })
        const [notice] = emailService.sendMail.mock.calls[0]
        expect(notice.to).toBe(representative.email)
        expect(notice).not.toHaveProperty("cc")
        expect(notice.textBody).toContain("No contamos con el producto solicitado")
        expect(JSON.stringify(notice)).not.toContain("compras@cliente.example")
        expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()
        // Repeating the same rejection notifies nobody again; another reason or any other decision is refused.
        expect((await reject("No contamos con el producto solicitado")).body.data).not.toHaveProperty("representativeNotified")
        expect(emailService.sendMail).toHaveBeenCalledTimes(1)
        expect((await reject("Otro motivo distinto")).status).toBe(409)
        const linesDigest = rejected.body.data.linesDigest
        expect((await request(server).post(`/api/admin/quote-reviews/${orderId}/approve`).set(admin).send({ profitPerPound: "0.1", linesDigest, delivery: "none" })).status).toBe(409)
        expect((await request(server).post(`/api/admin/quote-reviews/${orderId}/preview`).set(admin).send({ profitPerPound: "0.1" })).status).toBe(409)
        expect((await request(server).post(`/api/admin/quote-reviews/${orderId}/notify`).set(admin)).status).toBe(409)
        expect((await request(server).post(`/api/admin/quote-reviews/${orderId}/delivery`).set(admin).field("recipients", "representative")
            .attach("file", Buffer.from("%PDF-1.4"), { filename: "c.pdf", contentType: "application/pdf" })).status).toBe(409)
        expect(emailService.sendMailWithAttachment).not.toHaveBeenCalled()

        // The representative sees the rejection and its reason, never prices; the order takes no more lines.
        const status = (await request(server).get(`/api/quote-reviews/${orderId}`).set(rep)).body.data
        expect(status).toMatchObject({ status: "rejected", rejectionReason: "No contamos con el producto solicitado", deliveryRecipients: null })
        expect(status).not.toHaveProperty("finalPrice")
        const linesBefore = await model("Quote").count({ where: { salespersonId: representative.id } })
        expect((await request(server).post("/api/quotes").set(rep).send(input)).status).toBe(409)
        expect(await model("Quote").count({ where: { salespersonId: representative.id } })).toBe(linesBefore)
        expect((await request(server).post(`/api/quote-reviews/${orderId}`).set(rep).send({})).status).toBe(409)
        // Rejected orders never show up among the approved quotes.
        const listed = await request(server).get("/api/admin/quotes").set(admin)
        expect(listed.body.data.some((row: { id: number }) => row.id === saved.body.data.id)).toBe(false)
    }, 60000)

    test("management review: a new-product line that started before the approval (or before the review existed) is rejected", async () => {
        const model = (name: string) => sequelize.models[name] as any
        const { Transaction } = require("sequelize") as typeof import("sequelize")
        const { assertQuoteOrderOpen, lockQuoteOrder } = require("../features/quoteReview/services/quoteOrderLock") as typeof import("../features/quoteReview/services/quoteOrderLock")
        const readCommitted = { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }
        const orderId = randomUUID()
        const salespersonId = (jwt.decode(representativeToken) as unknown as { sub: number }).sub
        // Mirrors catalogQuote.service::confirmCatalogQuote: its transaction has already run a statement
        // (the confirmation-key lock) when management changes the review under the order lock, as
        // quoteReview.service does; the check that follows must see that change, not an older snapshot.
        const changedWhileWaiting = (orderId: string, change: () => Promise<unknown>) => sequelize.transaction(readCommitted, async transaction => {
            await model("QuoteOrderReview").findOne({ where: { orderId }, transaction })
            await sequelize.transaction(async other => { await lockQuoteOrder(orderId, other); await change() })
            await assertQuoteOrderOpen(orderId, transaction)
        })
        // a) The review was "pending" when the transaction started.
        const review = await model("QuoteOrderReview").create({ orderId, salespersonId, clientName: "SNAPSHOT", clientEmail: "compras@cliente.example", linesDigest: "a".repeat(64) })
        await expect(changedWhileWaiting(orderId, () => review.update({ status: "approved", reviewedAt: new Date() }))).rejects.toMatchObject({ statusCode: 409 })
        // b) The review did not exist yet: it is created and approved before the check.
        const unseenOrderId = randomUUID()
        await expect(changedWhileWaiting(unseenOrderId, async () => {
            const created = await model("QuoteOrderReview").create({ orderId: unseenOrderId, salespersonId, clientName: "UNSEEN", clientEmail: "compras@cliente.example", linesDigest: "a".repeat(64) })
            await created.update({ status: "approved", reviewedAt: new Date() })
        })).rejects.toMatchObject({ statusCode: 409 })
        // c) The review is rejected while waiting: a rejected order takes no more lines either.
        const rejectedOrderId = randomUUID()
        const pendingReview = await model("QuoteOrderReview").create({ orderId: rejectedOrderId, salespersonId, clientName: "REJECTED", linesDigest: "a".repeat(64) })
        await expect(changedWhileWaiting(rejectedOrderId, () => pendingReview.update({ status: "rejected", rejectionReason: "Sin producto", reviewedAt: new Date() }))).rejects.toMatchObject({ statusCode: 409, message: "errors.quote_review_rejected" })

        // A send interrupted after claiming it ("sending" with no outcome) is offered again only once it is stale.
        const { emailService } = require("../shared/services/email.service") as { emailService: { sendMailWithAttachment: jest.Mock } }
        const admin = { Authorization: `Bearer ${adminToken}` }
        const retryable = async () => (await request(server).get(`/api/admin/quote-reviews/${orderId}`).set(admin)).body.data.deliveryAvailable
        expect(await retryable()).toBe(true) // Approved, send never started.
        await sequelize.query(`UPDATE "quoteOrderReviews" SET "clientEmailStatus"='sending', "updatedAt"=NOW() WHERE "orderId"=:orderId`, { replacements: { orderId } })
        expect(await retryable()).toBe(false)
        const resend = () => request(server).post(`/api/admin/quote-reviews/${orderId}/delivery`).set(admin).field("recipients", "representative_and_client").attach("file", Buffer.from("%PDF-1.4 synthetic"), { filename: "Cotizacion.pdf", contentType: "application/pdf" })
        expect((await resend()).status).toBe(409)
        await sequelize.query(`UPDATE "quoteOrderReviews" SET "updatedAt"=NOW() - INTERVAL '11 minutes' WHERE "orderId"=:orderId`, { replacements: { orderId } })
        expect(await retryable()).toBe(true)
        emailService.sendMailWithAttachment.mockReset().mockResolvedValue(undefined)
        const recovered = await resend()
        expect(recovered.status).toBe(200)
        expect(recovered.body.data.deliveryStatus).toBe("sent")
        expect(emailService.sendMailWithAttachment).toHaveBeenCalledTimes(1)
        expect(await retryable()).toBe(false)
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
        const updateProfile = async (payload: typeof body) => {
            const response = await request(server).put(`/api/generic-packaging-configurations/${profile.id}`).set("Authorization", `Bearer ${adminToken}`).send(payload)
            expect(response.status).toBe(200)
            const refreshed = await request(server).get("/api/generic-packaging-configurations").set("Authorization", `Bearer ${adminToken}`)
            expect(refreshed.status).toBe(200)
            return refreshed.body.data.find((row: any) => row.id === profile.id)
        }
        // Round-trip edits must retain active associations and their IDs, not just return 200.
        const savedState = (value: unknown) => JSON.parse(JSON.stringify(value, (key, field) => key === "updatedAt" ? undefined : field))
        const renamed = await updateProfile({ ...body, displayName: "Edited generic configuration" })
        expect(renamed.ready).toBe(true)
        expect(renamed.displayName).toBe("Edited generic configuration")
        expect(savedState(renamed.groups)).toEqual(savedState(profile.groups))
        expect(renamed.bagsPerBox).toBe(profile.bagsPerBox)
        expect(renamed.boxesPerPallet).toBe(profile.boxesPerPallet)
        const changed = await updateProfile({ ...body, boxesPerPallet: 70, groups: body.groups.map(g => g.level === "pallet" ? { ...g, options: g.options.map(o => ({ ...o, quantityValue: 90 })) } : g) })
        expect(changed.ready).toBe(true)
        expect(changed.boxesPerPallet).toBe(70)
        expect(savedState(changed.groups.find((g: any) => g.level === "unit"))).toEqual(savedState(profile.groups.find((g: any) => g.level === "unit")))
        expect(Number(changed.groups.find((g: any) => g.level === "pallet").options[0].quantityValue)).toBe(90)
        const restored = await updateProfile(body)
        expect(savedState(restored.groups)).toEqual(savedState(profile.groups))
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
        const withoutOption = await updateProfile({ ...body, groups: body.groups.map(g => g.level === "pallet" ? { ...g, options: [] } : g) })
        expect(withoutOption.groups.find((g: any) => g.level === "pallet").options).toEqual([])
        expect(savedState(withoutOption.groups.find((g: any) => g.level === "unit"))).toEqual(savedState(bagGroup))
        const withoutGroup = await updateProfile({ ...body, groups: body.groups.filter(g => g.level === "unit") })
        expect(savedState(withoutGroup.groups)).toEqual(savedState([bagGroup]))
        expect(savedState((await updateProfile(body)).groups)).toEqual(savedState(profile.groups))
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
    test("client pallet rules apply automatically to every SKU, reject overrides and protect assigned materials", async () => {
        const model = (name: string) => sequelize.models[name] as any
        const client = await model("Client").create({ name: "Synthetic pallet exception" })
        const kit = model("PalletKitMaterial"), packaging = model("Packaging")
        const before = await kit.findAll()
        const original = before.map((row: any) => ({ id: row.id, palletClientIds: row.palletClientIds }))
        const createPallet = (code: string, unitCost: number) => packaging.create({ code, displayName: code, classification: "generic", packagingRole: "pallet", materialType: "TARIMA", defaultQuantityBasis: "per_pallet", defaultQuantityValue: 1, unitCost })
        const standard = await createPallet("SYNTHETIC-PALLET-DEFAULT", 12)
        const special = await createPallet("SYNTHETIC-PALLET-EXCEPTION", 21)
        await kit.bulkCreate([{ packagingId: standard.id }, { packagingId: special.id }])
        const admin = { Authorization: `Bearer ${adminToken}` }
        const rules = { defaultPackagingId: standard.id, overrides: [{ clientId: client.id, packagingId: special.id }] }
        try {
            expect((await request(server).put("/api/pallet-kit/pallet-rules").set(admin).send(rules)).status).toBe(200)
            expect((await request(server).put("/api/pallet-kit/pallet-rules").set({ Authorization: `Bearer ${representativeToken}` }).send(rules)).status).toBe(401)
            expect((await request(server).put("/api/pallet-kit/pallet-rules").set(admin).send({ ...rules, overrides: [...rules.overrides, ...rules.overrides] })).status).toBe(400)
            expect((await request(server).delete(`/api/pallet-kit/materials/${special.id}`).set(admin)).status).toBe(409)
            const { loadPalletKit, palletKitLines } = require("../features/palletKit/services/palletKit.service")
            const defaultKit = await loadPalletKit(), clientKit = await loadPalletKit(undefined, client.id)
            expect(defaultKit[0].options.map((row: any) => row.id)).toEqual([standard.id])
            expect(clientKit[0].options.map((row: any) => row.id)).toEqual([special.id])
            expect(palletKitLines(clientKit, [], 2, "es")[0].line.lineTotal).toBe(42)
            expect(() => palletKitLines(clientKit, [{ type: "TARIMA", packagingId: standard.id }], 2, "es")).toThrow()
            const { confirmCatalogQuote } = require("../features/customQuote/services/catalogQuote.service")
            await expect(confirmCatalogQuote(1, { input: { clientId: client.id }, order: { clientId: null }, previewToken: "invalid" }, "es")).rejects.toMatchObject({ statusCode: 409 })
        } finally {
            for (const row of original) await kit.update({ palletClientIds: row.palletClientIds }, { where: { id: row.id } })
            await kit.destroy({ where: { packagingId: [standard.id, special.id] } })
            await packaging.destroy({ where: { id: [standard.id, special.id] } })
            await client.destroy()
        }
    }, 60000)

})
