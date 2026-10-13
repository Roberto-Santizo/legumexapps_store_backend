import { Sequelize } from "sequelize-typescript"
import { QueryTypes, Transaction } from "sequelize"
import { env } from "../config/env"
import { parseDatabaseConnection } from "../config/databaseConnection"
import { databaseModels } from "./models"
import { assertApplicationRole, assertDatabaseReady } from "./schemaReadiness"

const target = parseDatabaseConnection(env.databaseUrl, env.nodeEnv, env.databaseCaCert)
const sequelize = new Sequelize(target.database, target.username, target.password, {
    dialect: "postgres", host: target.host, port: target.port,
    logging: false, minifyAliases: true, models: databaseModels,
    dialectOptions: { ssl: target.ssl, options: "-c search_path=public", connectionTimeoutMillis: 10000 },
})

/** Startup only authenticates and inspects. Schema and seed writes belong to approved commands. */
export async function connectDB(): Promise<void> {
    try {
        if (env.dbSyncAlter) throw new Error("DB_SYNC_ALTER=true is blocked at startup")
        await sequelize.authenticate()
        await sequelize.transaction({ readOnly: true, isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
            // Sequelize's readOnly option selects a read pool; PostgreSQL still needs this statement.
            await sequelize.query("SET TRANSACTION READ ONLY", { transaction })
            await sequelize.query("SET LOCAL statement_timeout = '5000ms'", { transaction })
            await sequelize.query("SET LOCAL lock_timeout = '1000ms'", { transaction })
            const inspector = { query: async (sql: string) => ({ rows: await sequelize.query(sql, { type: QueryTypes.SELECT, transaction }) }) }
            await assertApplicationRole(inspector, env.databaseRolePolicy)
            await assertDatabaseReady(inspector, sequelize)
        })
        if (env.databaseRolePolicy === "owner") console.warn("DB_ROLE_POLICY=owner: elevated schema/history and role-management privileges accepted; use restricted credentials when available.")
        console.log("Database verified; application startup performed no schema or seed writes")
    } catch {
        // Driver errors may contain SQL, row values, hostnames or credentials.
        console.error("Database startup rejected; verify configuration, migration history, schema and controlled bootstrap. Sensitive details suppressed.")
        process.exit(1)
    }
}

export default sequelize
