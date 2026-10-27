import { Sequelize } from "sequelize-typescript"
import { QueryTypes, Transaction } from "sequelize"
import { env } from "../config/env"
import { parseDatabaseConnection } from "../config/databaseConnection"
import { databaseModels } from "./models"
import { assertApplicationRole, assertDatabaseReady, assertPostgresCapabilities, SchemaCompatibilityError } from "./schemaReadiness"
import { synchronizeDevelopment } from "./developmentSync"
import { runSeeders } from "./seeders"

const target = parseDatabaseConnection(env.databaseUrl, env.nodeEnv, env.databaseCaCert)
const sequelize = new Sequelize(target.database, target.username, target.password, {
    dialect: "postgres", host: target.host, port: target.port,
    logging: false, minifyAliases: true, models: databaseModels,
    dialectOptions: { ssl: target.ssl, options: "-c search_path=public", connectionTimeoutMillis: 10000 },
})

/** Development explicitly synchronizes; normal and production startup remain read-only. */
export async function connectDB(): Promise<void> {
    let stage="conexión"
    try {
        if (env.dbSyncAlter && env.nodeEnv !== "development") throw new Error("DB_SYNC_ALTER=true is blocked outside development")
        await sequelize.authenticate()
        if (env.nodeEnv === "development" && process.env.npm_lifecycle_event === "dev") {
            console.log(`Development sync alter:true: ${target.host}:${target.port}/${target.database}`)
            stage="sincronización de modelos"
            await synchronizeDevelopment(sequelize, env.nodeEnv)
            stage="seeders"
            console.log('[DB] Ejecutando seeders de permisos y unidades...')
            await runSeeders(sequelize)
            console.log("Development models synchronized; existing tables are not force-recreated")
            return
        }
        await sequelize.transaction({ readOnly: true, isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
            // Sequelize's readOnly option selects a read pool; PostgreSQL still needs this statement.
            await sequelize.query("SET TRANSACTION READ ONLY", { transaction })
            await sequelize.query("SET LOCAL statement_timeout = '5000ms'", { transaction })
            await sequelize.query("SET LOCAL lock_timeout = '1000ms'", { transaction })
            const inspector = { query: async (sql: string) => ({ rows: await sequelize.query(sql, { type: QueryTypes.SELECT, transaction }) }) }
            await assertPostgresCapabilities(inspector)
            await assertApplicationRole(inspector, env.databaseRolePolicy)
            await assertDatabaseReady(inspector, sequelize)
        })
        if (env.databaseRolePolicy === "owner") console.warn("DB_ROLE_POLICY=owner: elevated schema and role-management privileges accepted; use restricted credentials when available.")
        console.log("Database verified; application startup performed no schema or seed writes")
    } catch (error) {
        if(env.nodeEnv==='development' && process.env.npm_lifecycle_event==='dev') {
            const code=(error as any)?.original?.code
            console.error(`[DB] Falló ${stage}${typeof code==='string'&&/^[A-Z0-9]{5}$/.test(code)?` (PostgreSQL ${code})`:''}.`)
            if(code==='55P03') console.error('[DB] Otra sesión mantiene un bloqueo. Detené las otras consolas de desarrollo y volvé a intentar.')
            if(code==='57014') console.error('[DB] La consulta superó el tiempo máximo permitido; la sincronización no pudo completarse.')
            if(error instanceof Error && error.message.startsWith('Invalid bootstrap credentials;'))
                console.error('[DB] Administrador inicial inválido: SEED_ADMIN_USERNAME debe tener 3–100 letras, números o _.@-. SEED_ADMIN_PASSWORD requiere mínimo 16 caracteres y máximo 72 bytes UTF-8, sin caracteres de control. No se guardaron los seeders.')
        }
        // Only trusted model/complement diagnostics may be printed. Never expose driver payloads.
        console.error(error instanceof SchemaCompatibilityError ? error.message : "Database startup rejected; verify configuration and schema. Sensitive details suppressed.")
        process.exit(1)
    }
}

export default sequelize
