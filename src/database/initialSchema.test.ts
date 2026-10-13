import fs from "node:fs"
import path from "node:path"
import { Sequelize } from "sequelize-typescript"
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
            const attributes = { ...model.rawAttributes }
            if (model.tableName === "packagings") {
                delete attributes.classification
                delete attributes.displayNameEn
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
