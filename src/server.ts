import express from "express"
import cors from "cors"
import appRouter from "./routes"
import { errorHandler } from "./shared/middlewares/errorHandler"
import i18next, { i18nextMiddleware } from "./config/i18n"
import { env } from "./config/env"

const server = express()

// No exponer la versión/tecnología del framework vía el header "X-Powered-By".
server.disable("x-powered-by")

server.set("trust proxy", 1)

// Solo el frontend conocido (ver FRONTEND_URL en env) puede leer las respuestas de la API --
// un origin "*" permitiría a cualquier sitio hacer requests cross-origin en nombre del usuario.
server.use(cors({
    origin: env.frontendUrl,
}))

server.use(express.json({ limit: "20mb" }))

server.use(i18nextMiddleware.handle(i18next))

server.use("/api", appRouter)

server.get("/", (_req, res) => {
    res.json({ message: "Legumex Quote API" })
})

server.use(errorHandler)

export default server
