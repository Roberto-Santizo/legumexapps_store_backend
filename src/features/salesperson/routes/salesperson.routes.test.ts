jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret" } }))
jest.mock("../services/salesperson.service", () => ({ salespersonService: { createSalesperson: jest.fn(), updateSalesperson: jest.fn() } }))
jest.mock("../services/representativeClient.service", () => ({ representativeClientService: {} }))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./salesperson.routes"
import { salespersonService as service } from "../services/salesperson.service"

const app = buildTestApp("/api/salespeople", router)
const token = (permissions: string[]) => `Bearer ${jwt.sign({ sub: 1, type: "staff", permissions }, "test-secret")}`
const account = { name: "Ana", email: "ANA@example.com", password: "secret123" }
beforeEach(() => {
    jest.resetAllMocks()
    ;(service.createSalesperson as jest.Mock).mockResolvedValue({ id: 9, name: "Ana" })
    ;(service.updateSalesperson as jest.Mock).mockResolvedValue({ id: 9, name: "Ana" })
})

test("creating without clients only needs the create permission", async () => {
    const res = await request(app).post("/api/salespeople").set("Authorization", token(["salespeople:create"])).send(account)
    expect(res.status).toBe(201)
    expect(service.createSalesperson).toHaveBeenCalledWith({ ...account, email: "ana@example.com" })
})
test.each([{ clientIds: [2] }, { assignAllClients: true }])("initial clients %j also require the client permission", async clients => {
    const res = await request(app).post("/api/salespeople").set("Authorization", token(["salespeople:create"])).send({ ...account, ...clients })
    expect(res.status).toBe(403)
    expect(service.createSalesperson).not.toHaveBeenCalled()
})
test.each([{ clientIds: [2, 3] }, { assignAllClients: true }])("creates with initial clients %j in one request", async clients => {
    const res = await request(app).post("/api/salespeople").set("Authorization", token(["salespeople:create", "clients:view"])).send({ ...account, ...clients })
    expect(res.status).toBe(201)
    expect(service.createSalesperson).toHaveBeenCalledWith({ ...account, email: "ana@example.com", ...clients })
})
test.each([{ clientIds: [] }, { clientIds: [2, 2] }, { clientIds: [0] }, { clientIds: Array.from({ length: 101 }, (_, i) => i + 1) }, { clientIds: [2], assignAllClients: true }])("rejects invalid initial clients %j", async clients => {
    const res = await request(app).post("/api/salespeople").set("Authorization", token(["salespeople:create", "clients:view"])).send({ ...account, ...clients })
    expect(res.status).toBe(400)
    expect(service.createSalesperson).not.toHaveBeenCalled()
})
test("editing the account never assigns clients", async () => {
    const res = await request(app).patch("/api/salespeople/9").set("Authorization", token(["salespeople:edit"])).send({ name: "Ana B", clientIds: [2], assignAllClients: true })
    expect(res.status).toBe(200)
    expect(service.updateSalesperson).toHaveBeenCalledWith(9, { name: "Ana B" })
})
