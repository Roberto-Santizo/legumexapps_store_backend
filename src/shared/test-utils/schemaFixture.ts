import { Sequelize } from "sequelize-typescript"
import { databaseModels } from "../../database/models"
import { schemaChecks, schemaFunctions, schemaTriggers } from "../../database/schemaExtras"

// Focused concurrency fixtures only; the full 53-model creator is tested separately in public.
export async function createFixtureModels(client: any, tables: string[]): Promise<void> {
    const metadata = new Sequelize({ dialect: "postgres", logging: false, models: databaseModels })
    try {
        const generator = metadata.getQueryInterface().queryGenerator as any
        for (const table of tables) {
            const model = metadata.modelManager.models.find(item => item.tableName === table)!
            const attributes = generator.attributesToSQL(model.rawAttributes, { context: "createTable", table })
            await client.query(generator.createTableQuery(table, attributes, model.options))
            for (const index of model.options.indexes ?? []) await client.query(generator.addIndexQuery(table, index))
        }
        for (const check of schemaChecks.filter(item => tables.includes(item.table)))
            await client.query(`ALTER TABLE "${check.table}" ADD CONSTRAINT "${check.name}" CHECK (${check.expression})`)
    } finally { await metadata.close() }
}
export async function installFixtureProtections(client: any, generic = false): Promise<void> {
    const names = generic ? schemaFunctions.map(fn => fn.name) : ["guard_packaging_assignment", "guard_packaging_reclassification"]
    for (const fn of schemaFunctions.filter(fn => names.includes(fn.name)))
        await client.query(`CREATE OR REPLACE FUNCTION ${fn.name}() RETURNS trigger LANGUAGE plpgsql AS $$${fn.body}$$`)
    for (const trigger of schemaTriggers.filter(trigger => names.includes(trigger.functionName)))
        await client.query(`CREATE TRIGGER ${trigger.name} ${trigger.event} ON "${trigger.table}" FOR EACH ROW EXECUTE FUNCTION ${trigger.functionName}(${trigger.arguments})`)
}
