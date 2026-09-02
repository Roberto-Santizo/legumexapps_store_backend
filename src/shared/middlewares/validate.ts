import { Request, Response, NextFunction, RequestHandler } from "express"
import { ZodType } from "zod"

type RequestLocation = "body" | "params" | "query"

export function validate(schema: ZodType, location: RequestLocation = "body"): RequestHandler {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req[location])
        if (!result.success) {
            next(result.error)
            return
        }
        // No se puede usar `req[location] = result.data` a secas: en Express 5, `req.query` es
        // un getter sin setter definido en el prototipo (delega a parseurl en cada acceso), así
        // que una asignación directa tira "Cannot set property query of #<IncomingMessage> which
        // has only a getter". Redefinir la propiedad como own-property normal (writable) funciona
        // para los tres locations (body/params siguen siendo simples propiedades escribibles, no
        // se rompe nada ahí) y además hace que quede escribible para el resto del ciclo de vida
        // del request, no solo esta asignación.
        Object.defineProperty(req, location, {
            value: result.data,
            writable: true,
            enumerable: true,
            configurable: true,
        })
        next()
    }
}
