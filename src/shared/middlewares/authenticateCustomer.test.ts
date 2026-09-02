import jwt from "jsonwebtoken"
import { Request, Response, NextFunction } from "express"

jest.mock("../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))

import { authenticateCustomer } from "./authenticateCustomer"

function fakeReq(authorizationHeader?: string): Request {
    return { headers: { authorization: authorizationHeader } } as unknown as Request
}

const res = {} as Response

describe("authenticateCustomer (JWT de cliente)", () => {
    it("deja pasar un token válido de tipo customer y adjunta req.customer", () => {
        const token = jwt.sign({ sub: 42, type: "customer" }, "test-secret")
        const req = fakeReq(`Bearer ${token}`)
        const next = jest.fn() as unknown as NextFunction

        authenticateCustomer(req, res, next)

        expect(req.customer).toEqual({ id: 42 })
        expect(next).toHaveBeenCalledWith()
    })

    it("rechaza un token de tipo 'staff' en una ruta de cliente", () => {
        const token = jwt.sign({ sub: 42, type: "staff", roleId: 1, roleName: "Admin", permissions: [] }, "test-secret")
        const req = fakeReq(`Bearer ${token}`)
        const next = jest.fn() as unknown as NextFunction

        authenticateCustomer(req, res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
        expect(req.customer).toBeUndefined()
    })

    it("rechaza sin header Authorization", () => {
        const next = jest.fn() as unknown as NextFunction

        authenticateCustomer(fakeReq(undefined), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })

    it("rechaza un token firmado con un secreto distinto", () => {
        const token = jwt.sign({ sub: 42, type: "customer" }, "otro-secreto")
        const next = jest.fn() as unknown as NextFunction

        authenticateCustomer(fakeReq(`Bearer ${token}`), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })

    it("rechaza un token malformado (no JWT)", () => {
        const next = jest.fn() as unknown as NextFunction

        authenticateCustomer(fakeReq("Bearer esto-no-es-un-jwt"), res, next)

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
    })
})
