jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/lead.service", () => ({
    leadService: {
        createLead: jest.fn(),
    }
}))

import request from "supertest"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import leadRouter from "./lead.routes"
import { leadService } from "../services/lead.service"

const app = buildTestApp("/api/leads", leadRouter)

const validPayload = {
    fullName: "Jane Doe",
    companyName: "Acme Foods",
    phone: "+502 5555 5555",
    email: "jane@acme.com",
}

describe("leadRouter (HTTP) — formulario público, sin auth", () => {
    it("POST / sin body -> 400, no llega al service", async () => {
        const res = await request(app).post("/api/leads").send({})
        expect(res.status).toBe(400)
        expect(leadService.createLead).not.toHaveBeenCalled()
    })

    it("POST / con body válido -> 201 y crea el lead", async () => {
        (leadService.createLead as jest.Mock).mockResolvedValue({ id: 1, ...validPayload })

        const res = await request(app).post("/api/leads").send(validPayload)

        expect(res.status).toBe(201)
        expect(leadService.createLead).toHaveBeenCalledWith(validPayload)
    })

    it("POST / con el honeypot 'website' relleno -> 201 igual, pero NO crea el lead", async () => {
        const res = await request(app)
            .post("/api/leads")
            .send({ ...validPayload, website: "http://spambot.example" })

        expect(res.status).toBe(201)
        expect(leadService.createLead).not.toHaveBeenCalled()
    })

    it("POST / no requiere autenticación", async () => {
        (leadService.createLead as jest.Mock).mockResolvedValue({ id: 2, ...validPayload })
        const res = await request(app).post("/api/leads").send(validPayload)
        expect(res.status).not.toBe(401)
    })
})
