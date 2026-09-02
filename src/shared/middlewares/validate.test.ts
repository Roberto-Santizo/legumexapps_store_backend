import { z } from "zod"
import { Request, Response, NextFunction } from "express"
import { validate } from "./validate"

const res = {} as Response

describe("validate", () => {
    const schema = z.object({
        productVariantId: z.number().int().positive(),
        requestedPallets: z.number().int().min(1),
    })

    it("llama a next() sin error y reemplaza req.body con los datos parseados si el body es válido", () => {
        const req = { body: { productVariantId: 10, requestedPallets: 2 } } as unknown as Request
        const next = jest.fn() as unknown as NextFunction

        validate(schema)(req, res, next)

        expect(next).toHaveBeenCalledWith()
        expect(req.body).toEqual({ productVariantId: 10, requestedPallets: 2 })
    })

    it("llama a next(error) con un ZodError si el body es inválido, sin tocar req.body", () => {
        const req = { body: { productVariantId: -1, requestedPallets: 0 } } as unknown as Request
        const next = jest.fn() as unknown as NextFunction

        validate(schema)(req, res, next)

        expect(next).toHaveBeenCalledTimes(1)
        const errorPassed = (next as jest.Mock).mock.calls[0][0]
        expect(errorPassed.name).toBe("ZodError")
    })

    it("rechaza campos faltantes", () => {
        const req = { body: { productVariantId: 10 } } as unknown as Request
        const next = jest.fn() as unknown as NextFunction

        validate(schema)(req, res, next)

        const errorPassed = (next as jest.Mock).mock.calls[0][0]
        expect(errorPassed.name).toBe("ZodError")
    })

    it("valida req.query en vez de req.body cuando se pide explícitamente", () => {
        const querySchema = z.object({ page: z.coerce.number().int().min(1) })
        const req = { query: { page: "2" } } as unknown as Request
        const next = jest.fn() as unknown as NextFunction

        validate(querySchema, "query")(req, res, next)

        expect(next).toHaveBeenCalledWith()
        expect(req.query).toEqual({ page: 2 })
    })
})
