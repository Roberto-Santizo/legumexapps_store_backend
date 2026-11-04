import jwt from "jsonwebtoken"
import { Request, Response, NextFunction } from "express"

jest.mock("../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))

import { authenticate } from "./authenticate"
import { AppError } from "../errors/AppError"

const activeAccount = jest.fn<Promise<boolean>, [number]>()
beforeEach(() => activeAccount.mockReset().mockResolvedValue(true))

function fakeReq(authorizationHeader?: string): Request {
    return { headers: { authorization: authorizationHeader }, app: { locals: { accountStatus: { isStaffActive: activeAccount } } } } as unknown as Request
}

const res = {} as Response

function sign(payload: object, secret = "test-secret"): string {
    return jwt.sign(payload, secret)
}

describe("authenticate (JWT de staff)", () => {
    it("rejects an existing token immediately after the account is deactivated", async () => {
        const token = sign({ sub: 7, type: "staff", permissions: ["products:edit"] })
        const next = jest.fn()
        await authenticate(fakeReq(`Bearer ${token}`), res, next)
        expect(next).toHaveBeenLastCalledWith()
        activeAccount.mockResolvedValue(false)
        const deactivated = fakeReq(`Bearer ${token}`)
        await authenticate(deactivated, res, next)
        expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 401 }))
        expect(deactivated.user).toBeUndefined()
    })

    it("fails closed when account persistence cannot be checked", async () => {
        activeAccount.mockRejectedValue(new Error("synthetic unavailable database"))
        const next = jest.fn()
        const req = fakeReq(`Bearer ${sign({ sub: 7, type: "staff", permissions: [] })}`)
        await authenticate(req, res, next)
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
        expect(req.user).toBeUndefined()
    })

    it("deja pasar un token válido de tipo staff y adjunta req.user desde el payload", async () => {
        const token = sign({ sub: 7, type: "staff", roleId: 2, roleName: "Admin", permissions: ["products:edit"] })
        const req = fakeReq(`Bearer ${token}`)
        const next = jest.fn() as unknown as NextFunction

        await authenticate(req, res, next)

        expect(req.user).toEqual({ id: 7, roleId: 2, roleName: "Admin", permissions: ["products:edit"] })
        expect(next).toHaveBeenCalledWith() // sin argumentos = sin error
    })

    it("rechaza si no hay header Authorization", async () => {
        const next = jest.fn() as unknown as NextFunction

        await authenticate(fakeReq(undefined), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })

    it("rechaza si el header no empieza con 'Bearer '", async () => {
        const next = jest.fn() as unknown as NextFunction

        await authenticate(fakeReq("Basic abc123"), res, next)

        expect(next).toHaveBeenCalledWith(expect.any(AppError))
    })

    it("rechaza un token firmado con un secreto distinto (no debe confiar en tokens ajenos)", async () => {
        const token = sign({ sub: 7, type: "staff", roleId: 2, roleName: "Admin", permissions: [] }, "otro-secreto")
        const next = jest.fn() as unknown as NextFunction

        await authenticate(fakeReq(`Bearer ${token}`), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })

    it("rechaza un token expirado", async () => {
        const token = jwt.sign({ sub: 7, type: "staff", roleId: 2, roleName: "Admin", permissions: [] }, "test-secret", { expiresIn: -10 })
        const next = jest.fn() as unknown as NextFunction

        await authenticate(fakeReq(`Bearer ${token}`), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })

    it("rechaza un token de tipo 'customer' en una ruta de staff (no deben ser intercambiables)", async () => {
        const token = sign({ sub: 7, type: "customer" })
        const next = jest.fn() as unknown as NextFunction

        await authenticate(fakeReq(`Bearer ${token}`), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
        expect((fakeReq() as Request).user).toBeUndefined()
    })

    it("rechaza un token con alg=none (payload sin firma real)", async () => {
        // jsonwebtoken no deja firmar con "none" directo -- se arma el JWT a mano para
        // simular un token forjado que intenta evitar la verificación de firma.
        const forgedHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
        const forgedPayload = Buffer.from(JSON.stringify({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions: ["*"] })).toString("base64url")
        const forgedToken = `${forgedHeader}.${forgedPayload}.`
        const next = jest.fn() as unknown as NextFunction

        await authenticate(fakeReq(`Bearer ${forgedToken}`), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })
})
