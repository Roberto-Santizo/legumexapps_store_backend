import { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { env } from "../../config/env"
import { AppError } from "../errors/AppError"
import { AuthenticatedCustomer } from "../types/express"

interface CustomerAccessTokenPayload {
    sub: number
    type: string
}

export function authenticateCustomer(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization
    if (!header?.startsWith("Bearer ")) {
        next(new AppError(401, "errors.unauthenticated"))
        return
    }

    const token = header.slice("Bearer ".length)

    try {
        const payload = jwt.verify(token, env.jwtSecret) as unknown as CustomerAccessTokenPayload
        if (payload.type !== "customer") {
            next(new AppError(401, "errors.unauthenticated"))
            return
        }

        const customer: AuthenticatedCustomer = { id: payload.sub }
        req.customer = customer
        next()
    } catch {
        next(new AppError(401, "errors.unauthenticated"))
    }
}
