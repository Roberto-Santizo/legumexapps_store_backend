import colors from "colors"
import { seedAccessControl } from "./accessControl.seeder"
import { seedPackagingGroups } from "./packagingGroup.seeder"

export async function runSeeders(): Promise<void> {
    await seedAccessControl()
    await seedPackagingGroups()
    console.log(colors.cyan.bold("Seeders executed successfully"))
}
