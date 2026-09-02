import { z } from "zod"
import { ValidationError as SequelizeValidationError, UniqueConstraintError } from "sequelize"
import { Request, Response, NextFunction } from "express"
import { errorHandler } from "./errorHandler"
import { AppError, NotFoundError } from "../errors/AppError"

function fakeRes(): Response {
    const res = {} as Response
    res.status = jest.fn().mockReturnValue(res)
    res.json = jest.fn().mockReturnValue(res)
    return res
}

function fakeReq(): Request {
    // req.t normalmente lo inyecta i18next-http-middleware -- acá devolvemos la key tal cual
    // para poder aseverar qué mensaje/params eligió errorHandler, sin depender de traducciones reales.
    return { t: jest.fn((key: string) => key) } as unknown as Request
}

const next = jest.fn() as unknown as NextFunction

describe("errorHandler", () => {
    let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
    })

    it("mapea AppError a su statusCode y traduce la key con sus params", () => {
        const req = fakeReq()
        const res = fakeRes()

        errorHandler(new AppError(422, "errors.pallet_not_configured"), req, res, next)

        expect(res.status).toHaveBeenCalledWith(422)
        expect(res.json).toHaveBeenCalledWith({ message: "errors.pallet_not_configured" })
    })

    it("resuelve el nombre del recurso en NotFoundError antes de traducir el mensaje final", () => {
        const req = fakeReq()
        const res = fakeRes()

        errorHandler(new NotFoundError("Quote", 5), req, res, next)

        expect(res.status).toHaveBeenCalledWith(404)
        // req.t se llama primero para resolver "resources.Quote" y ese resultado se mete
        // como param al traducir "errors.not_found" -- confirma que no se manda el id crudo sin traducir el recurso.
        expect(req.t).toHaveBeenCalledWith("resources.Quote", { defaultValue: "Quote" })
        expect(req.t).toHaveBeenCalledWith("errors.not_found", expect.objectContaining({ resource: "resources.Quote", id: 5 }))
    })

    it("mapea ZodError a 400 con el detalle de cada issue", () => {
        const req = fakeReq()
        const res = fakeRes()
        const parseResult = z.object({ pallets: z.number() }).safeParse({ pallets: "not-a-number" })

        errorHandler(parseResult.error, req, res, next)

        expect(res.status).toHaveBeenCalledWith(400)
        const payload = (res.json as jest.Mock).mock.calls[0][0]
        expect(payload.message).toBe("errors.validation")
        expect(payload.details).toHaveLength(1)
        expect(payload.details[0].path).toBe("pallets")
    })

    it("mapea UniqueConstraintError a 409", () => {
        const req = fakeReq()
        const res = fakeRes()
        const error = new UniqueConstraintError({ errors: [{ message: "email must be unique" } as never] })

        errorHandler(error, req, res, next)

        expect(res.status).toHaveBeenCalledWith(409)
        const payload = (res.json as jest.Mock).mock.calls[0][0]
        expect(payload.message).toBe("errors.unique_constraint")
        expect(payload.details).toEqual(["email must be unique"])
    })

    it("mapea SequelizeValidationError (no unique) a 400", () => {
        const req = fakeReq()
        const res = fakeRes()
        const error = new SequelizeValidationError("Validation error", [{ message: "netWeightGrams cannot be null" } as never])

        errorHandler(error, req, res, next)

        expect(res.status).toHaveBeenCalledWith(400)
        const payload = (res.json as jest.Mock).mock.calls[0][0]
        expect(payload.details).toEqual(["netWeightGrams cannot be null"])
    })

    it("cualquier error no reconocido cae a 500 genérico y se loguea server-side, sin filtrar detalles internos al cliente", () => {
        const req = fakeReq()
        const res = fakeRes()

        errorHandler(new Error("algo explotó con detalles internos sensibles"), req, res, next)

        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json).toHaveBeenCalledWith({ message: "errors.internal" })
        expect(consoleErrorSpy).toHaveBeenCalled()
    })
})
