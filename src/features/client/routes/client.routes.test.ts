import { Table, Column, DataType, HasMany } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Product from "../../product/models/Product.model"

jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/client.service", () => ({
    clientService: {
        listClients: jest.fn(),
        getClientById: jest.fn(),
        createClient: jest.fn(),
        updateClient: jest.fn(),
        setClientStatus: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import clientRouter from "./client.routes"
import { clientService } from "../services/client.service"

const app = buildTestApp("/api/clients", clientRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

describe("clientRouter (HTTP) — RBAC cableado en la ruta real", () => {
    it("GET / sin token -> 401", async () => {
        const res = await request(app).get("/api/clients")
        expect(res.status).toBe(401)
    })

    it("GET / con token de cliente final (tipo incorrecto) -> 401, no 403", async () => {
        const customerToken = jwt.sign({ sub: 1, type: "customer" }, "test-secret")
        const res = await request(app).get("/api/clients").set("Authorization", `Bearer ${customerToken}`)
        expect(res.status).toBe(401)
    })

    it("GET / con staff autenticado pero SIN 'clients:view' -> 403", async () => {
        const res = await request(app).get("/api/clients").set("Authorization", `Bearer ${staffToken(["products:view"])}`)
        expect(res.status).toBe(403)
        expect(clientService.listClients).not.toHaveBeenCalled()
    })

    it("GET / con 'clients:view' -> 200", async () => {
        (clientService.listClients as jest.Mock).mockResolvedValue({ data: [{ id: 1, name: "Acme" }] })

        const res = await request(app).get("/api/clients").set("Authorization", `Bearer ${staffToken(["clients:view"])}`)

        expect(res.status).toBe(200)
    })

    it("POST / con 'clients:view' (no 'clients:create') -> 403, ver != crear", async () => {
        const res = await request(app)
            .post("/api/clients")
            .set("Authorization", `Bearer ${staffToken(["clients:view"])}`)
            .send({ name: "Acme" })

        expect(res.status).toBe(403)
        expect(clientService.createClient).not.toHaveBeenCalled()
    })

    it("POST / con 'clients:create' pero body inválido -> 400 antes de llegar al service", async () => {
        const res = await request(app)
            .post("/api/clients")
            .set("Authorization", `Bearer ${staffToken(["clients:create"])}`)
            .send({}) 

        expect(res.status).toBe(400)
        expect(clientService.createClient).not.toHaveBeenCalled()
    })

    it("POST / con 'clients:create' y el campo requerido -> 201", async () => {
        (clientService.createClient as jest.Mock).mockResolvedValue({ id: 2, name: "Acme" })

        const res = await request(app)
            .post("/api/clients")
            .set("Authorization", `Bearer ${staffToken(["clients:create"])}`)
            .send({ name: "Acme" })

        expect(res.status).toBe(201)
        expect(clientService.createClient).toHaveBeenCalledWith({ name: "Acme" })
    })

    it("PATCH /:id/status con 'clients:edit' -> 200", async () => {
        (clientService.setClientStatus as jest.Mock).mockResolvedValue({ id: 2, name: "Acme", isActive: false })

        const res = await request(app)
            .patch("/api/clients/2/status")
            .set("Authorization", `Bearer ${staffToken(["clients:edit"])}`)
            .send({ isActive: false })

        expect(res.status).toBe(200)
        expect(clientService.setClientStatus).toHaveBeenCalledWith(2, false)
    })

    it("PATCH /:id con un id no numérico -> 400 (falla la validación de params antes del permiso de negocio)", async () => {
        const res = await request(app)
            .patch("/api/clients/abc")
            .set("Authorization", `Bearer ${staffToken(["clients:edit"])}`)
            .send({ name: "Acme" })

        expect(res.status).toBe(400)
        expect(clientService.updateClient).not.toHaveBeenCalled()
    })
})