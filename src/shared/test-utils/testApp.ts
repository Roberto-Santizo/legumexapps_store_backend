import express, { Express, Router } from "express"
import i18next, { i18nextMiddleware } from "../../config/i18n"
import { errorHandler } from "../middlewares/errorHandler"

// App mínima para pruebas de contrato HTTP (supertest): mismo pipeline que server.ts
// (json -> i18n -> router -> errorHandler) pero montando un único router a la vez, para
// no arrastrar el resto de las features (y sus modelos/servicios) a cada test de rutas.
export function buildTestApp(mountPath: string, router: Router): Express {
    const app = express()
    app.use(express.json())
    app.use(i18nextMiddleware.handle(i18next))
    app.use(mountPath, router)
    app.use(errorHandler)
    return app
}
