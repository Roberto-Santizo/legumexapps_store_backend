jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/quoteDraft.service", () => ({
    quoteDraftService: { upsertFromCalculation: jest.fn(), markConverted: jest.fn(), listDrafts: jest.fn() }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import adminQuoteDraftRouter from "./adminQuoteDraft.routes"
import { quoteDraftService } from "../services/quoteDraft.service"

const app = buildTestApp("/api/admin/quote-drafts", adminQuoteDraftRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

const salespersonToken = jwt.sign({ sub: 42, type: "customer" }, "test-secret")

describe("adminQuoteDraftRouter (HTTP) -- seguimiento de cotizaciones sin finalizar", () => {
    it("401 sin Authorization", async () => {
        const res = await request(app).get("/api/admin/quote-drafts")
        expect(res.status).toBe(401)
        expect(quoteDraftService.listDrafts).not.toHaveBeenCalled()
    })

    it("401 con un token de representante -- solo staff", async () => {
        const res = await request(app).get("/api/admin/quote-drafts").set("Authorization", `Bearer ${salespersonToken}`)
        expect(res.status).toBe(401)
    })

    it("403 para un staff sin \"quoteDrafts:view\", aunque tenga \"quotes:view\" (permiso independiente)", async () => {
        const res = await request(app)
            .get("/api/admin/quote-drafts")
            .set("Authorization", `Bearer ${staffToken(["quotes:view", "quotes:calculate"])}`)

        expect(res.status).toBe(403)
        expect(quoteDraftService.listDrafts).not.toHaveBeenCalled()
    })

    it("200 con la lista del service para un staff con \"quoteDrafts:view\"", async () => {
        (quoteDraftService.listDrafts as jest.Mock).mockResolvedValue([{ id: 1, state: "abandoned" }])

        const res = await request(app)
            .get("/api/admin/quote-drafts")
            .set("Authorization", `Bearer ${staffToken(["quoteDrafts:view"])}`)

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ data: [{ id: 1, state: "abandoned" }] })
        expect(quoteDraftService.listDrafts).toHaveBeenCalledWith(undefined, undefined)
    })

    it("reenvía el rango de fechas opcional como días YYYY-MM-DD (hora de Guatemala)", async () => {
        (quoteDraftService.listDrafts as jest.Mock).mockResolvedValue([])

        const res = await request(app)
            .get("/api/admin/quote-drafts?startDate=2026-09-01&endDate=2026-09-10")
            .set("Authorization", `Bearer ${staffToken(["quoteDrafts:view"])}`)

        expect(res.status).toBe(200)
        expect(quoteDraftService.listDrafts).toHaveBeenCalledWith("2026-09-01", "2026-09-10")
    })

    it("400 si la fecha no es un día YYYY-MM-DD válido (instante ISO o día inexistente)", async () => {
        for (const query of ["startDate=2026-09-01T00:00:00.000Z", "endDate=2026-02-30"]) {
            const res = await request(app)
                .get(`/api/admin/quote-drafts?${query}`)
                .set("Authorization", `Bearer ${staffToken(["quoteDrafts:view"])}`)

            expect(res.status).toBe(400)
        }
        expect(quoteDraftService.listDrafts).not.toHaveBeenCalled()
    })

    it("400 si startDate es posterior a endDate", async () => {
        const res = await request(app)
            .get("/api/admin/quote-drafts?startDate=2026-09-10&endDate=2026-09-01")
            .set("Authorization", `Bearer ${staffToken(["quoteDrafts:view"])}`)

        expect(res.status).toBe(400)
        expect(quoteDraftService.listDrafts).not.toHaveBeenCalled()
    })
})
