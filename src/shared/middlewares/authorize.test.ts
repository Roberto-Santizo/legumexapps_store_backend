import { Request, Response, NextFunction } from "express"
import { authorize } from "./authorize"

const res = {} as Response

function fakeReq(user?: { permissions: string[] }): Request {
    return { user } as unknown as Request
}

describe("authorize", () => {
    it("deja pasar si req.user tiene el permiso requerido", () => {
        const next = jest.fn() as unknown as NextFunction

        authorize("products:edit")(fakeReq({ permissions: ["products:edit", "products:view"] }), res, next)

        expect(next).toHaveBeenCalledWith()
    })

    it("rechaza con 403 si el usuario no tiene el permiso (aunque esté autenticado)", () => {
        const next = jest.fn() as unknown as NextFunction

        authorize("products:edit")(fakeReq({ permissions: ["products:view"] }), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }))
    })

    it("rechaza con 401 si no hay req.user (no pasó por authenticate)", () => {
        const next = jest.fn() as unknown as NextFunction

        authorize("products:edit")(fakeReq(undefined), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })

    it("no confunde un permiso con prefijo similar (ej. 'products:edit' vs 'products:editall')", () => {
        const next = jest.fn() as unknown as NextFunction

        authorize("products:edit")(fakeReq({ permissions: ["products:editall"] }), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }))
    })

    it("rechaza si el usuario no tiene ningún permiso asignado", () => {
        const next = jest.fn() as unknown as NextFunction

        authorize("quotes:view")(fakeReq({ permissions: [] }), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }))
    })
})
