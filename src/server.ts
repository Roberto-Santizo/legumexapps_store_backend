import express from "express"
import cors from "cors"
import appRouter from "./routes"
import { errorHandler } from "./shared/middlewares/errorHandler"
import i18next, { i18nextMiddleware } from "./config/i18n"
import { env } from "./config/env"

const server = express()

// No exponer la versión/tecnología del framework vía el header "X-Powered-By".
server.disable("x-powered-by")

// Sin ETags (2026-09-22): esta app es una API JSON pura (no sirve estáticos -- las imágenes
// viven en S3, ver CLAUDE.md #2), pero Express genera un ETag por default en cada respuesta JSON
// igual. Con un ETag + If-None-Match del lado del cliente, un GET repetido con el mismo cuerpo
// (ej. GET /quotes/products sin cambios en el catálogo) responde 304 Not Modified sin body --
// axios se lo entrega tal cual al caller, y el zod .parse(data) del frontend revienta contra un
// body vacío (ver el fix del frontend en shared/api). El SPA siempre necesita el JSON real para
// validarlo con zod, así que el cacheo condicional no aporta nada acá y solo rompe el parse --
// se apaga globalmente en vez de parchear cada endpoint uno por uno.
server.set("etag", false)

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
