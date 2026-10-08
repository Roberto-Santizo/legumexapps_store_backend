import { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { env } from "../../config/env"
import { AppError } from "../errors/AppError"
import { AuthenticatedSalesperson } from "../types/express"

interface SalespersonAccessTokenPayload {
    sub: number
    type: string
}

// El claim `type` se queda literal "customer" a propósito: es el valor que ya llevan los JWT emitidos
// y cambiarlo invalidaría toda sesión activa.
export function authenticateSalesperson(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization
    if (!header?.startsWith("Bearer ")) {
        next(new AppError(401, "errors.unauthenticated"))
        return
    }

    const token = header.slice("Bearer ".length)

    try {
        const payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }) as unknown as SalespersonAccessTokenPayload
        if (payload.type !== "customer") {
            next(new AppError(401, "errors.unauthenticated"))
            return
        }

        const salesperson: AuthenticatedSalesperson = { id: payload.sub }
        req.salesperson = salesperson
        next()
    } catch {
        next(new AppError(401, "errors.unauthenticated"))
    }
}
