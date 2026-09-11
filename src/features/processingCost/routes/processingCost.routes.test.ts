// Prueba de contrato HTTP para el RBAC en sí -- authorize.test.ts ya prueba el middleware
// aislado, esto prueba que quedó CABLEADO correctamente en la ruta real (permiso equivocado,
// ruta sin proteger, etc. no se detectan con un test unitario del middleware solo). Mismo patrón
// que destination.routes.test.ts.
jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/processingCost.service", () => ({
    processingCostService: {
        listProcessingCosts: jest.fn(),
        getProcessingCostById: jest.fn(),
        createProcessingCost: jest.fn(),
        updateProcessingCost: jest.fn(),
        deleteProcessingCost: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import processingCostRouter from "./processingCost.routes"
import { processingCostService } from "../services/processingCost.service"

const app = buildTestApp("/api/processing-costs", processingCostRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

describe("processingCostRouter (HTTP) — RBAC cableado en la ruta real", () => {
    it("GET / sin token -> 401", async () => {
        const res = await request(app).get("/api/processing-costs")
        expect(res.status).toBe(401)
    })

    it("GET / con token de cliente (tipo incorrecto) -> 401, no 403", async () => {
        const customerToken = jwt.sign({ sub: 1, type: "customer" }, "test-secret")
        const res = await request(app).get("/api/processing-costs").set("Authorization", `Bearer ${customerToken}`)
        expect(res.status).toBe(401)
    })

    it("GET / con staff autenticado pero SIN 'processingCosts:view' -> 403", async () => {
        const res = await request(app).get("/api/processing-costs").set("Authorization", `Bearer ${staffToken(["products:view"])}`)
        expect(res.status).toBe(403)
        expect(processingCostService.listProcessingCosts).not.toHaveBeenCalled()
    })

    it("GET / con 'processingCosts:view' -> 200", async () => {
        (processingCostService.listProcessingCosts as jest.Mock).mockResolvedValue({ data: [] })

        const res = await request(app).get("/api/processing-costs").set("Authorization", `Bearer ${staffToken(["processingCosts:view"])}`)

        expect(res.status).toBe(200)
    })

    it("POST / con 'processingCosts:view' (no 'processingCosts:create') -> 403, ver != crear", async () => {
        const res = await request(app)
            .post("/api/processing-costs")
            .set("Authorization", `Bearer ${staffToken(["processingCosts:view"])}`)
            .send({ displayName: "Energía", value: 0.15, calculationType: "per_weight" })

        expect(res.status).toBe(403)
        expect(processingCostService.createProcessingCost).not.toHaveBeenCalled()
    })

    it("POST / con 'processingCosts:create' pero body inválido -> 400 antes de llegar al service", async () => {
        const res = await request(app)
            .post("/api/processing-costs")
            .set("Authorization", `Bearer ${staffToken(["processingCosts:create"])}`)
            .send({ value: -5 }) // falta displayName/calculationType, value negativo

        expect(res.status).toBe(400)
        expect(processingCostService.createProcessingCost).not.toHaveBeenCalled()
    })

    it("POST / con calculationType desconocido -> 400 (solo per_weight/percentage son válidos)", async () => {
        const res = await request(app)
            .post("/api/processing-costs")
            .set("Authorization", `Bearer ${staffToken(["processingCosts:create"])}`)
            .send({ displayName: "Energía", value: 0.15, calculationType: "por_hora" })

        expect(res.status).toBe(400)
        expect(processingCostService.createProcessingCost).not.toHaveBeenCalled()
    })

    it("POST / con 'processingCosts:create' y body válido -> 201", async () => {
        (processingCostService.createProcessingCost as jest.Mock).mockResolvedValue({
            id: 1,
            displayName: "Energía",
            value: 0.15,
            calculationType: "per_weight",
        })

        const res = await request(app)
            .post("/api/processing-costs")
            .set("Authorization", `Bearer ${staffToken(["processingCosts:create"])}`)
            .send({ displayName: "Energía", value: 0.15, calculationType: "per_weight" })

        expect(res.status).toBe(201)
        expect(processingCostService.createProcessingCost).toHaveBeenCalledWith({
            displayName: "Energía",
            value: 0.15,
            calculationType: "per_weight",
        })
    })

    it("PUT /:id sin 'processingCosts:edit' -> 403", async () => {
        const res = await request(app)
            .put("/api/processing-costs/1")
            .set("Authorization", `Bearer ${staffToken(["processingCosts:view"])}`)
            .send({ value: 0.2, calculationType: "per_weight" })

        expect(res.status).toBe(403)
        expect(processingCostService.updateProcessingCost).not.toHaveBeenCalled()
    })

    it("DELETE /:id con un id no numérico -> 400 (falla la validación de params antes del permiso de negocio)", async () => {
        const res = await request(app)
            .delete("/api/processing-costs/abc")
            .set("Authorization", `Bearer ${staffToken(["processingCosts:delete"])}`)

        expect(res.status).toBe(400)
        expect(processingCostService.deleteProcessingCost).not.toHaveBeenCalled()
    })
})
