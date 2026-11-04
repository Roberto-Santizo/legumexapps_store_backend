import jwt from "jsonwebtoken"
import { Request, Response, NextFunction } from "express"

jest.mock("../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))

import { authenticateSalesperson } from "./authenticateSalesperson"

const activeAccount = jest.fn<Promise<boolean>, [number]>()
beforeEach(() => activeAccount.mockReset().mockResolvedValue(true))

function fakeReq(authorizationHeader?: string): Request {
    return { headers: { authorization: authorizationHeader }, app: { locals: { accountStatus: { isSalespersonActive: activeAccount } } } } as unknown as Request
}

const res = {} as Response

describe("authenticateSalesperson (JWT de representante Legumex)", () => {
    it("rejects an existing representative token when the account is inactive", async () => {
        activeAccount.mockResolvedValue(false)
        const token = jwt.sign({ sub: 42, type: "customer" }, "test-secret")
        const req = fakeReq(`Bearer ${token}`)
        const next = jest.fn()
        await authenticateSalesperson(req, res, next)
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
        expect(req.salesperson).toBeUndefined()
    })

    it("deja pasar un token válido de tipo customer (literal sin cambios, rename 2026-09-16) y adjunta req.salesperson", async () => {
        const token = jwt.sign({ sub: 42, type: "customer" }, "test-secret")
        const req = fakeReq(`Bearer ${token}`)
        const next = jest.fn() as unknown as NextFunction

        await authenticateSalesperson(req, res, next)

        expect(req.salesperson).toEqual({ id: 42 })
        expect(next).toHaveBeenCalledWith()
    })

    it("rechaza un token de tipo 'staff' en una ruta de representante", async () => {
        const token = jwt.sign({ sub: 42, type: "staff", roleId: 1, roleName: "Admin", permissions: [] }, "test-secret")
        const req = fakeReq(`Bearer ${token}`)
        const next = jest.fn() as unknown as NextFunction

        await authenticateSalesperson(req, res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
        expect(req.salesperson).toBeUndefined()
    })

    it("rechaza sin header Authorization", async () => {
        const next = jest.fn() as unknown as NextFunction

        await authenticateSalesperson(fakeReq(undefined), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })

    it("rechaza un token firmado con un secreto distinto", async () => {
        const token = jwt.sign({ sub: 42, type: "customer" }, "otro-secreto")
        const next = jest.fn() as unknown as NextFunction

        await authenticateSalesperson(fakeReq(`Bearer ${token}`), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })

    it("rechaza un token malformado (no JWT)", async () => {
        const next = jest.fn() as unknown as NextFunction

        await authenticateSalesperson(fakeReq("Bearer esto-no-es-un-jwt"), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })
})
