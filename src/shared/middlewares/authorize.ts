import { Request, Response, NextFunction, RequestHandler } from "express"
import { AppError } from "../errors/AppError"

export function authorize(requiredPermission: string): RequestHandler {
    return (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) {
            next(new AppError(401, "errors.unauthenticated"))
            return
        }
        if (!req.user.permissions.includes(requiredPermission)) {
            next(new AppError(403, "errors.forbidden"))
            return
        }
        next()
    }
}
