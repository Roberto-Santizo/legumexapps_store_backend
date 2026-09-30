jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/adminCustomQuote.service", () => ({
    adminCustomQuoteService: { listCustomQuotes: jest.fn(), getCustomQuoteById: jest.fn(), setCustomQuoteStatus: jest.fn() }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import adminCustomQuoteRouter from "./adminCustomQuote.routes"
import { adminCustomQuoteService } from "../services/adminCustomQuote.service"
import { NotFoundError } from "../../../shared/errors/AppError"

const BASE = "/api/admin/custom-quotes"
const app = buildTestApp(BASE, adminCustomQuoteRouter)

function staffToken(permissions: string[]): string {
    return `Bearer ${jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")}`
}

const list = adminCustomQuoteService.listCustomQuotes as jest.Mock
const getById = adminCustomQuoteService.getCustomQuoteById as jest.Mock
const setStatus = adminCustomQuoteService.setCustomQuoteStatus as jest.Mock

beforeEach(() => {
    list.mockResolvedValue([])
})

describe("adminCustomQuoteRouter -- permisos", () => {
    it("sin token -> 401", async () => {
        const res = await request(app).get(BASE)
        expect(res.status).toBe(401)
    })

    it("token de representante -> 401", async () => {
        const res = await request(app).get(BASE).set("Authorization", `Bearer ${jwt.sign({ sub: 42, type: "customer" }, "test-secret")}`)
        expect(res.status).toBe(401)
    })

    it.each([["quotes:view"], ["quoteDrafts:view"], ["customQuoteConfig:edit"]])(
        "con solo '%s' -> 403 (permiso propio, independiente)",
        async (permission) => {
            const res = await request(app).get(BASE).set("Authorization", staffToken([permission]))
            expect(res.status).toBe(403)
            expect(list).not.toHaveBeenCalled()
        }
    )

    it("customQuotes:view no alcanza para cambiar el estado -> 403", async () => {
        const res = await request(app)
            .patch(`${BASE}/5/status`)
            .set("Authorization", staffToken(["customQuotes:view"]))
            .send({ status: "reviewed" })
        expect(res.status).toBe(403)
        expect(setStatus).not.toHaveBeenCalled()
    })
})

describe("GET /", () => {
    it("200 sin filtros", async () => {
        list.mockResolvedValue([{ id: 5 }])

        const res = await request(app).get(BASE).set("Authorization", staffToken(["customQuotes:view"]))

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ data: [{ id: 5 }] })
        expect(list).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined, status: undefined }, "es")
    })

    it("reenvía rango (días YYYY-MM-DD) y estado", async () => {
        await request(app)
            .get(`${BASE}?startDate=2026-09-01&endDate=2026-09-10&status=reviewed`)
            .set("Authorization", staffToken(["customQuotes:view"]))

        expect(list).toHaveBeenCalledWith({ startDate: "2026-09-01", endDate: "2026-09-10", status: "reviewed" }, "es")
    })

    it.each([
        ["un instante ISO", "startDate=2026-09-01T00:00:00.000Z"],
        ["un día inexistente", "endDate=2026-02-30"],
        ["inicio posterior al fin", "startDate=2026-09-10&endDate=2026-09-01"],
        ["un estado desconocido", "status=won"],
    ])("400 con %s", async (_label, query) => {
        const res = await request(app).get(`${BASE}?${query}`).set("Authorization", staffToken(["customQuotes:view"]))
        expect(res.status).toBe(400)
        expect(list).not.toHaveBeenCalled()
    })
})

describe("GET /:id", () => {
    it("200 con el detalle", async () => {
        getById.mockResolvedValue({ id: 5, totalCost: 322.8234 })

        const res = await request(app).get(`${BASE}/5`).set("Authorization", staffToken(["customQuotes:view"]))

        expect(res.status).toBe(200)
        expect(getById).toHaveBeenCalledWith(5, "es")
    })

    it("id no numérico -> 400; inexistente -> 404", async () => {
        const bad = await request(app).get(`${BASE}/abc`).set("Authorization", staffToken(["customQuotes:view"]))
        expect(bad.status).toBe(400)

        getById.mockRejectedValue(new NotFoundError("CustomQuote", 99))
        const missing = await request(app).get(`${BASE}/99`).set("Authorization", staffToken(["customQuotes:view"]))
        expect(missing.status).toBe(404)
    })
})

describe("PATCH /:id/status", () => {
    it("200 con customQuotes:edit", async () => {
        setStatus.mockResolvedValue({ id: 5, status: "in_development" })

        const res = await request(app)
            .patch(`${BASE}/5/status`)
            .set("Authorization", staffToken(["customQuotes:edit"]))
            .send({ status: "in_development" })

        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({ id: 5, status: "in_development" })
        expect(setStatus).toHaveBeenCalledWith(5, "in_development")
    })

    it("estado desconocido o faltante -> 400", async () => {
        for (const body of [{ status: "won" }, {}]) {
            const res = await request(app).patch(`${BASE}/5/status`).set("Authorization", staffToken(["customQuotes:edit"])).send(body)
            expect(res.status).toBe(400)
        }
        expect(setStatus).not.toHaveBeenCalled()
    })
})
