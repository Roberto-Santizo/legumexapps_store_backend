import type { Sequelize } from "sequelize-typescript"
import { installPostgresComplements } from "./schemaCreation"
import { schemaTriggers } from "./schemaExtras"
import { QueryTypes, type Model, type ModelStatic } from "sequelize"

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
        let completed=0
        console.log(`[DB] Sincronizando ${models.length} tablas con alter:true...`)
        for(const model of models) model.addHook('afterSync','development-progress',()=>{
            completed++
            if(completed===1 || completed%10===0 || completed===models.length)
                console.log(`[DB] Tablas sincronizadas: ${completed}/${models.length} (${String(model.getTableName())})`)
        })
        try { await db.sync(options) }
        finally { for(const model of models) model.removeHook('afterSync','development-progress') }
        console.log('[DB] Restaurando restricciones y triggers...')
        await installPostgresComplements(db,transaction)
        console.log('[DB] Esquema sincronizado; confirmando transacción...')
    })
}
