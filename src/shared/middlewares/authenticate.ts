import { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { env } from "../../config/env"
import { AppError } from "../errors/AppError"
import { AuthenticatedUser } from "../types/express"

interface AccessTokenPayload {
    sub: number
    type: string
    roleId: number
    roleName: string
    permissions: string[]
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization
    if (!header?.startsWith("Bearer ")) {
        next(new AppError(401, "errors.unauthenticated"))
        return
    }

    const token = header.slice("Bearer ".length)

    try {
        const payload = jwt.verify(token, env.jwtSecret) as unknown as AccessTokenPayload
        if (payload.type !== "staff") {
            next(new AppError(401, "errors.unauthenticated"))
            return
        }

        const user: AuthenticatedUser = {
            id: payload.sub,
            roleId: payload.roleId,
            roleName: payload.roleName,
            permissions: payload.permissions
        }
        req.user = user
        next()
    } catch {
        next(new AppError(401, "errors.unauthenticated"))
    }
}
