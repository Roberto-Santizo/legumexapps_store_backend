import colors from "colors"
import { seedAccessControl } from "./accessControl.seeder"

export async function runSeeders(): Promise<void> {
    await seedAccessControl()
    console.log(colors.cyan.bold("Seeders executed successfully"))
}
