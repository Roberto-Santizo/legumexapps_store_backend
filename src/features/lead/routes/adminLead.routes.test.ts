jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/lead.service", () => ({
    leadService: {
        listLeads: jest.fn(),
        getLeadById: jest.fn(),
        updateLead: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import adminLeadRouter from "./adminLead.routes"
import { leadService } from "../services/lead.service"

const app = buildTestApp("/api/admin/leads", adminLeadRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

describe("adminLeadRouter (HTTP) — RBAC cableado en la ruta real", () => {
    it("GET / sin token -> 401", async () => {
        const res = await request(app).get("/api/admin/leads")
        expect(res.status).toBe(401)
    })

    it("GET / con staff autenticado pero SIN 'leads:view' -> 403", async () => {
        const res = await request(app).get("/api/admin/leads").set("Authorization", `Bearer ${staffToken(["products:view"])}`)
        expect(res.status).toBe(403)
        expect(leadService.listLeads).not.toHaveBeenCalled()
    })

    it("GET / con 'leads:view' -> 200", async () => {
        (leadService.listLeads as jest.Mock).mockResolvedValue({ data: [] })

        const res = await request(app).get("/api/admin/leads").set("Authorization", `Bearer ${staffToken(["leads:view"])}`)

        expect(res.status).toBe(200)
    })

    it("GET /:id con 'leads:view' -> 200", async () => {
        (leadService.getLeadById as jest.Mock).mockResolvedValue({ id: 1, fullName: "Jane Doe" })

        const res = await request(app).get("/api/admin/leads/1").set("Authorization", `Bearer ${staffToken(["leads:view"])}`)

        expect(res.status).toBe(200)
    })

    it("PATCH /:id con 'leads:view' (no 'leads:edit') -> 403, ver != editar", async () => {
        const res = await request(app)
            .patch("/api/admin/leads/1")
            .set("Authorization", `Bearer ${staffToken(["leads:view"])}`)
            .send({ status: "contacted" })

        expect(res.status).toBe(403)
        expect(leadService.updateLead).not.toHaveBeenCalled()
    })

    it("PATCH /:id con id no numérico -> 400 antes de llegar al service", async () => {
        const res = await request(app)
            .patch("/api/admin/leads/abc")
            .set("Authorization", `Bearer ${staffToken(["leads:edit"])}`)
            .send({ status: "contacted" })

        expect(res.status).toBe(400)
        expect(leadService.updateLead).not.toHaveBeenCalled()
    })

    it("PATCH /:id con 'leads:edit' y body válido -> 200", async () => {
        (leadService.updateLead as jest.Mock).mockResolvedValue({ id: 1, status: "contacted" })

        const res = await request(app)
            .patch("/api/admin/leads/1")
            .set("Authorization", `Bearer ${staffToken(["leads:edit"])}`)
            .send({ status: "contacted" })

        expect(res.status).toBe(200)
        expect(leadService.updateLead).toHaveBeenCalledWith(1, { status: "contacted" })
    })
})
