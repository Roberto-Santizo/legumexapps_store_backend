import type { Sequelize } from "sequelize-typescript"
import { installPostgresComplements } from "./schemaCreation"
import { schemaTriggers } from "./schemaExtras"
import { QueryTypes, type Model, type ModelStatic, type ModelAttributeColumnOptions } from "sequelize"

/** Explicitly development-only; production continues to verify without DDL. */
export async function synchronizeDevelopment(db: Sequelize, mode: string): Promise<void> {
    if (mode !== "development") throw Error("Automatic schema synchronization is development-only")
    await db.transaction(async transaction => {
        await db.query("SET LOCAL lock_timeout='5000ms'", {transaction})
        await db.query("SET LOCAL statement_timeout='60000ms'", {transaction})
        // PostgreSQL blocks alterColumn while an UPDATE OF trigger references that column.
        // Remove only our triggers and restore them before committing this same transaction.
        const tables=await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'",{type:QueryTypes.SELECT,transaction}) as {tablename:string}[]
        for(const trigger of schemaTriggers) if(tables.some(row=>row.tablename===trigger.table))
            await db.query(`DROP TRIGGER IF EXISTS ${trigger.name} ON public."${trigger.table}"`,{transaction})
        const options = {alter:true,force:false,transaction}
        const models=db.modelManager.models as unknown as ModelStatic<Model>[]
        const uniqueColumns = await db.query<{ table_name: string; column_name: string }>(`
            SELECT c.relname AS table_name, a.attname AS column_name
            FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace
            JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=con.conkey[1]
            WHERE n.nspname='public' AND con.contype='u' AND array_length(con.conkey,1)=1
              AND con.convalidated AND NOT con.condeferrable
              AND COALESCE((to_jsonb(con)->>'conenforced')::boolean,true)`, { type: QueryTypes.SELECT, transaction })
        const existingUniqueColumns = new Map<string, Set<string>>()
        for (const column of uniqueColumns) {
            const fields = existingUniqueColumns.get(column.table_name) ?? new Set<string>()
            fields.add(column.column_name)
            existingUniqueColumns.set(column.table_name, fields)
        }
        const preservedUniqueAttributes: ModelAttributeColumnOptions[] = []
        let completed=0
        console.log(`[DB] Sincronizando ${models.length} tablas con alter:true...`)
        try {
            for (const model of models) {
                const existing = existingUniqueColumns.get(String(model.getTableName()))
                for (const [name, attribute] of Object.entries(model.rawAttributes)) {
                    if (attribute.unique === true && existing?.has(attribute.field ?? name)) {
                        // Sequelize 6 otherwise adds another UNIQUE on every alter sync.
                        // The existing database constraint remains active throughout.
                        preservedUniqueAttributes.push(attribute)
                        attribute.unique = false
                    }
                }
                model.addHook('afterSync','development-progress',()=>{
                    completed++
                    if(completed===1 || completed%10===0 || completed===models.length)
                        console.log(`[DB] Tablas sincronizadas: ${completed}/${models.length} (${String(model.getTableName())})`)
                })
            }
            await db.sync(options)
        } finally {
            for (const attribute of preservedUniqueAttributes) attribute.unique = true
            for(const model of models) model.removeHook('afterSync','development-progress')
        }
        console.log('[DB] Restaurando restricciones y triggers...')
        await installPostgresComplements(db,transaction)
        console.log('[DB] Esquema sincronizado; confirmando transacción...')
    })
}
