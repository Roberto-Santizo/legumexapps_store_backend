import fs from "node:fs"
import path from "node:path"
import { DataType, Sequelize } from "sequelize-typescript"
import { Model, ModelStatic } from "sequelize"
import { databaseModels } from "./models"

// Metadata only: constructing Sequelize registers associations without opening a socket.
const sequelize = new Sequelize({ dialect: "postgres", logging: false, models: databaseModels })
const generator = sequelize.getQueryInterface().queryGenerator as any
const sql = fs.readFileSync(path.resolve(__dirname, "../../migrations/202610110001_initial_schema.sql"), "utf8")
const normalize = (value: string) => value.replace(/\s+/g, " ").trim()

describe("initial schema contract (offline)", () => {
    test("defines all pre-incremental tables with exact model columns, defaults, keys and foreign-key actions", () => {
        const ordered = (sequelize.modelManager.getModelsTopoSortedByForeignKey()! as unknown as ModelStatic<Model>[]).slice().reverse()
            .filter(model => model.tableName !== "representative_clients")
        expect(databaseModels).toHaveLength(47)
        expect(sql.match(/CREATE TABLE /g)).toHaveLength(46)
        let previousPosition = -1
        for (const model of ordered) {
            let attributes = { ...model.rawAttributes }
            if (model.tableName === "packagings") {
                delete attributes.classification
                delete attributes.displayNameEn
            }
            if (model.tableName === "rawMaterials") {
                // Created here, dropped by 202610140001_remove_raw_material_mixability.sql.
                const entries = Object.entries(attributes)
                const after = entries.findIndex(([name]) => name === "isOrganic") + 1
                entries.splice(after, 0, ["isMixable", { type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: "isMixable" } as any])
                attributes = Object.fromEntries(entries)
            }
            // Created here, dropped by 202610140002_remove_product_recipe_type.sql.
            if (model.tableName === "products") {
                const entries = Object.entries(attributes)
                const after = entries.findIndex(([name]) => name === "isOrganic") + 1
                entries.splice(after, 0, ["isCustomizable", { type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: "isCustomizable" } as any])
                attributes = Object.fromEntries(entries)
            }
            if (model.tableName === "productRawMaterials") {
                const entries = Object.entries(attributes)
                const after = entries.findIndex(([name]) => name === "percentage") + 1
                entries.splice(after, 0,
                    ["minPercentage", { type: DataType.DECIMAL(5, 2), allowNull: true, field: "minPercentage" } as any],
                    ["maxPercentage", { type: DataType.DECIMAL(5, 2), allowNull: true, field: "maxPercentage" } as any])
                attributes = Object.fromEntries(entries)
            }
            const expected = generator.createTableQuery(model.tableName,
                generator.attributesToSQL(attributes, { table: model.tableName }), model.options)
                .replace("CREATE TABLE IF NOT EXISTS", "CREATE TABLE")
            expect(normalize(sql)).toContain(normalize(expected))
            const position = sql.indexOf(`CREATE TABLE "${model.tableName}"`)
            expect(position).toBeGreaterThan(previousPosition)
            previousPosition = position
            for (const index of model.options.indexes ?? []) {
                expect(sql).toContain(generator.addIndexQuery(model.tableName, index.fields, index) + ";")
            }
            for (const attribute of Object.values(model.rawAttributes)) {
                const type = attribute.type as any
                if (type.key === "ENUM") {
                    const definition = `CREATE TYPE ${generator.pgEnumName(model.tableName, attribute.field)} AS ENUM (${type.values.map((value: string) => generator.escape(value)).join(", ")});`
                    expect(sql).toContain(definition)
                    expect(sql.indexOf(definition)).toBeLessThan(position)
                }
            }
        }
    })

    test("preserves SQL-history constraints and physical aliases without inserting data or shadowing incremental migrations", () => {
        expect(sql).toContain('CONSTRAINT "packagings_consumption_defaults_check" CHECK')
        expect(sql).toContain('CONSTRAINT "site_images_slotkey_unique" UNIQUE ("slotKey")')
        expect(sql).toContain('CREATE INDEX "customQuotes_source_variant_idx"')
        expect(sql).toContain('"customerId" INTEGER NOT NULL REFERENCES "customers"')
        expect(sql).toContain('"unitsPerBox" INTEGER')
        expect(sql).toContain('"isOrganicAvailable" BOOLEAN NOT NULL DEFAULT false')
        expect(sql).not.toMatch(/CREATE TABLE "representative_clients"|"classification"|"displayNameEn"/)
        expect(sql).not.toMatch(/\b(?:INSERT INTO|UPDATE\s+"|DELETE FROM|DROP TABLE|TRUNCATE)\b/i)
    })
})

describe("incremental migration chain (offline)", () => {
    const directory = path.resolve(__dirname, "../../migrations")

    test("keeps the applied history and appends only the isMixable and recipe-type removals", () => {
        expect(fs.readdirSync(directory).filter(name => name.endsWith(".sql")).sort()).toEqual([
            "202610110001_initial_schema.sql",
            "202610120001_representative_clients.sql",
            "202610120002_packaging_classification.sql",
            "202610140001_remove_raw_material_mixability.sql",
            "202610140002_remove_product_recipe_type.sql",
        ])
    })

    test("the isMixable removal drops exactly that column and nothing else", () => {
        const removal = fs.readFileSync(path.join(directory, "202610140001_remove_raw_material_mixability.sql"), "utf8")
        expect(normalize(removal)).toBe('ALTER TABLE public."rawMaterials" DROP COLUMN IF EXISTS "isMixable";')
        expect(Object.keys((databaseModels.find(model => (model as any).tableName === "rawMaterials") as any).rawAttributes)).not.toContain("isMixable")
    })

    test("the recipe-type removal drops exactly isCustomizable and the product min/max percentages", () => {
        const removal = fs.readFileSync(path.join(directory, "202610140002_remove_product_recipe_type.sql"), "utf8")
        expect(normalize(removal)).toBe('ALTER TABLE public."products" DROP COLUMN IF EXISTS "isCustomizable"; '
            + 'ALTER TABLE public."productRawMaterials" DROP COLUMN IF EXISTS "minPercentage", DROP COLUMN IF EXISTS "maxPercentage";')
        const attributesOf = (table: string) => Object.keys((databaseModels.find(model => (model as any).tableName === table) as any).rawAttributes)
        expect(attributesOf("products")).not.toContain("isCustomizable")
        expect(attributesOf("productRawMaterials")).not.toEqual(expect.arrayContaining(["minPercentage"]))
        expect(attributesOf("productRawMaterials")).not.toContain("maxPercentage")
        // The independent custom-quote allowed list keeps its own min/max range.
        expect(attributesOf("customQuoteRawMaterialOptions")).toEqual(expect.arrayContaining(["minPercentage", "maxPercentage"]))
    })
})
