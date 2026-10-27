import type { Sequelize } from "sequelize-typescript"
import { seedAccessControl } from "./accessControl.seeder"
import { seedUnits } from "./unit.seeder"

/** System data only; does not invent commercial catalogs or prompt for input. */
export async function runSeeders(db: Sequelize, source: NodeJS.ProcessEnv=process.env): Promise<void> {
    const seed=Boolean(source.SEED_ADMIN_USERNAME||source.SEED_ADMIN_PASSWORD)
    const credentials=seed?{username:source.SEED_ADMIN_USERNAME,password:source.SEED_ADMIN_PASSWORD}:
        {username:source.BOOTSTRAP_ADMIN_USERNAME,password:source.BOOTSTRAP_ADMIN_PASSWORD}
    await db.transaction(async transaction=>{
        await seedAccessControl(transaction,credentials)
        await seedUnits(transaction)
    })
}
