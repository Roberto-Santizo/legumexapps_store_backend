import "reflect-metadata"
import colors from "colors"
import server from "./server"
import { connectDB } from "./database/connection"
import { env } from "./config/env"

async function main(): Promise<void> {
    await connectDB()
    server.listen(env.serverPort, () => {
        console.log(colors.cyan.bold(`Server is running on port ${env.serverPort}`))
    })
}

main()
