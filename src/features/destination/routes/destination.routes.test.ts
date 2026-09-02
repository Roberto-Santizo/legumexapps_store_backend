// Prueba de contrato HTTP para el RBAC en sí -- authorize.test.ts ya prueba el middleware
// aislado, esto prueba que quedó CABLEADO correctamente en la ruta real (permiso equivocado,
// ruta sin proteger, etc. no se detectan con un test unitario del middleware solo).
jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/destination.service", () => ({
    destinationService: {
        listDestinations: jest.fn(),
        getDestinationById: jest.fn(),
        createDestination: jest.fn(),
        updateDestination: jest.fn(),
        deleteDestination: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import destinationRouter from "./destination.routes"
import { destinationService } from "../services/destination.service"

const app = buildTestApp("/api/destinations", destinationRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

describe("destinationRouter (HTTP) — RBAC cableado en la ruta real", () => {
    it("GET / sin token -> 401", async () => {
        const res = await request(app).get("/api/destinations")
        expect(res.status).toBe(401)
    })

    it("GET / con token de cliente (tipo incorrecto) -> 401, no 403", async () => {
        const customerToken = jwt.sign({ sub: 1, type: "customer" }, "test-secret")
        const res = await request(app).get("/api/destinations").set("Authorization", `Bearer ${customerToken}`)
        expect(res.status).toBe(401)
    })

    it("GET / con staff autenticado pero SIN 'destinations:view' -> 403", async () => {
        const res = await request(app).get("/api/destinations").set("Authorization", `Bearer ${staffToken(["products:view"])}`)
        expect(res.status).toBe(403)
        expect(destinationService.listDestinations).not.toHaveBeenCalled()
    })

    it("GET / con 'destinations:view' -> 200", async () => {
        (destinationService.listDestinations as jest.Mock).mockResolvedValue([{ id: 1, displayName: "Puerto Cortés" }])

        const res = await request(app).get("/api/destinations").set("Authorization", `Bearer ${staffToken(["destinations:view"])}`)

        expect(res.status).toBe(200)
    })

    it("POST / con 'destinations:view' (no 'destinations:create') -> 403, ver != crear", async () => {
        const res = await request(app)
            .post("/api/destinations")
            .set("Authorization", `Bearer ${staffToken(["destinations:view"])}`)
            .send({ displayName: "Puerto Barrios", baseCost: 50 })

        expect(res.status).toBe(403)
        expect(destinationService.createDestination).not.toHaveBeenCalled()
    })

    it("POST / con 'destinations:create' pero body inválido -> 400 antes de llegar al service", async () => {
        const res = await request(app)
            .post("/api/destinations")
            .set("Authorization", `Bearer ${staffToken(["destinations:create"])}`)
            .send({ baseCost: -5 }) // falta displayName, baseCost negativo

        expect(res.status).toBe(400)
        expect(destinationService.createDestination).not.toHaveBeenCalled()
    })

    it("POST / con 'destinations:create' y body válido -> 201", async () => {
        (destinationService.createDestination as jest.Mock).mockResolvedValue({ id: 2, displayName: "Puerto Barrios", baseCost: 50, country: "GT" })

        const res = await request(app)
            .post("/api/destinations")
            .set("Authorization", `Bearer ${staffToken(["destinations:create"])}`)
            .send({ displayName: "Puerto Barrios", baseCost: 50, country: "GT" })

        expect(res.status).toBe(201)
        expect(destinationService.createDestination).toHaveBeenCalledWith({ displayName: "Puerto Barrios", baseCost: 50, country: "GT" })
    })

    it("DELETE /:id con un id no numérico -> 400 (falla la validación de params antes del permiso de negocio)", async () => {
        const res = await request(app)
            .delete("/api/destinations/abc")
            .set("Authorization", `Bearer ${staffToken(["destinations:delete"])}`)

        expect(res.status).toBe(400)
        expect(destinationService.deleteDestination).not.toHaveBeenCalled()
    })
})
