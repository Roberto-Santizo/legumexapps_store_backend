import { QueryTypes } from "sequelize"
import type { Sequelize } from "sequelize-typescript"
import { assertSchemaReady, SchemaCompatibilityError, type InspectionClient } from "./schemaReadiness"

/** Additive synchronization only. Existing definitions must already match the models. */
export async function synchronizeSchema(db: Sequelize): Promise<void> {
    if (!db.modelManager.getModelsTopoSortedByForeignKey())
        throw new SchemaCompatibilityError("cyclic foreign keys cannot be synchronized safely")
    await db.transaction(async transaction => {
        await db.query("SET LOCAL statement_timeout='60000ms'", { transaction })
        await db.query("SET LOCAL lock_timeout='3000ms'", { transaction })
        const client: InspectionClient = { query: async sql => ({ rows: await db.query(sql, { transaction, type: QueryTypes.SELECT }) }) }
        const { rows: lock } = await client.query("SELECT pg_try_advisory_xact_lock(174227,1) AS acquired")
        if (lock[0]?.acquired !== true) throw new SchemaCompatibilityError("another schema operation is running")
        const { rows: columns } = await client.query(`SELECT c.relname AS table_name,a.attname AS field
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
            WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`)
        if (!columns.length) throw new SchemaCompatibilityError("empty database: use npm run dev to initialize development")
        const existing = new Map<string, Set<string>>()
        for (const column of columns) {
            if (!existing.has(column.table_name)) existing.set(column.table_name, new Set())
            existing.get(column.table_name)!.add(column.field)
        }
        // Project current metadata onto existing columns, without mutating registered models.
        // The existing strict verifier then rejects removals, renames and changed definitions.
        const models = db.modelManager.models.filter(model => existing.has(String(model.getTableName()))).map(model => {
            const fields = existing.get(String(model.getTableName()))!
            const attributes = Object.entries(model.rawAttributes)
            for (const [name, attribute] of attributes.filter(([, attr]) => !fields.has(attr.field!))) {
                const value = attribute.defaultValue
                const literal = value !== undefined && value !== null &&
                    (["string", "boolean"].includes(typeof value) || (typeof value === "number" && Number.isFinite(value)))
                if (attribute.primaryKey || attribute.autoIncrement || attribute.references || attribute.unique ||
                    (attribute.type as any).values || (value !== undefined && value !== null && !literal) ||
                    (attribute.allowNull === false && !literal))
                    throw new SchemaCompatibilityError(`unsafe new column ${String(model.getTableName())}.${name}: use a nullable plain column or a literal default; key, enum and expression changes are unsupported`)
            }
            const view = Object.create(model)
            Object.defineProperty(view, "rawAttributes", { value: Object.fromEntries(attributes.filter(([, attr]) => fields.has(attr.field!))) })
            return view
        })
        await assertSchemaReady(client, { modelManager: { models } } as Sequelize)
        // drop:false also disables changeColumn and foreign-key replacement in Sequelize 6.
        // Cyclic models are rejected above because their fallback forces alter:true.
        const options = { force: false, alter: { drop: false }, hooks: false, transaction }
        await db.sync(options)
        await assertSchemaReady(client, db)
    })
}
