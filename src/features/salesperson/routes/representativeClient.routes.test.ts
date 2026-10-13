jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret" } }))
jest.mock("../services/salesperson.service", () => ({ salespersonService: {} }))
jest.mock("../services/representativeClient.service", () => ({ representativeClientService: { list: jest.fn(), assign: jest.fn(), remove: jest.fn() } }))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./salesperson.routes"
import { representativeClientService as service } from "../services/representativeClient.service"
import { AppError } from "../../../shared/errors/AppError"

const app = buildTestApp("/api/salespeople", router)
const token = (permissions: string[], type = "staff") => jwt.sign({ sub: 1, type, permissions }, "test-secret")
const permissions = ["salespeople:view", "salespeople:edit", "clients:view"]
beforeEach(() => {
    jest.resetAllMocks()
    ;(service.list as jest.Mock).mockResolvedValue([])
    ;(service.assign as jest.Mock).mockResolvedValue([{ id: 2, name: "Client", isActive: true }])
    ;(service.remove as jest.Mock).mockResolvedValue([])
})

test.each(["get", "put", "delete"] as const)("%s rejects absent and representative tokens", async method => {
    const path = `/api/salespeople/1/clients${method === "delete" ? "/2" : ""}`
    expect((await request(app)[method](path).send({ clientIds: [2] })).status).toBe(401)
    expect((await request(app)[method](path).set("Authorization", `Bearer ${token(permissions, "customer")}`).send({ clientIds: [2] })).status).toBe(401)
    expect(service.list).not.toHaveBeenCalled()
    expect(service.assign).not.toHaveBeenCalled()
    expect(service.remove).not.toHaveBeenCalled()
})
test.each([
    ["get", "/clients", ["salespeople:view"]],
    ["get", "/clients", ["clients:view"]],
    ["put", "/clients", ["salespeople:view", "clients:view"]],
    ["put", "/clients", ["salespeople:edit"]],
    ["delete", "/clients/2", ["salespeople:view", "clients:view"]],
] as const)("%s enforces permissions %j", async (method, suffix, granted) => {
    const res = await request(app)[method](`/api/salespeople/1${suffix}`).set("Authorization", `Bearer ${token([...granted])}`).send({ clientIds: [2] })
    expect(res.status).toBe(403)
    expect(service.assign).not.toHaveBeenCalled()
    expect(service.remove).not.toHaveBeenCalled()
})
test("reads and adds multiple clients using parsed IDs", async () => {
    const header = `Bearer ${token(permissions)}`
    expect((await request(app).get("/api/salespeople/1/clients").set("Authorization", header)).body.data).toEqual([])
    const res = await request(app).put("/api/salespeople/1/clients").set("Authorization", header).set("Accept-Language", "en").send({ clientIds: [2, 3] })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe("Client assignments updated.")
    expect(service.assign).toHaveBeenCalledWith(1, [2, 3])
})
test.each([{}, { clientIds: [] }, { clientIds: [2, 2] }, { clientIds: [0] }, { clientIds: ["2"] }, { clientIds: [2147483648] }, { clientIds: Array.from({ length: 101 }, (_, i) => i + 1) }, { clientIds: [2], representativeId: 9 }])("rejects invalid batch %j", async body => {
    expect((await request(app).put("/api/salespeople/1/clients").set("Authorization", `Bearer ${token(permissions)}`).send(body)).status).toBe(400)
    expect(service.assign).not.toHaveBeenCalled()
})
test.each(["0", "-1", "abc", "2147483648", "1.5"])("rejects invalid representative ID %s", async id => {
    expect((await request(app).get(`/api/salespeople/${id}/clients`).set("Authorization", `Bearer ${token(permissions)}`)).status).toBe(400)
})
test("deletes the requested pair and translates responses", async () => {
    const res = await request(app).delete("/api/salespeople/1/clients/2").set("Authorization", `Bearer ${token(permissions)}`).set("Accept-Language", "es")
    expect(res.status).toBe(200)
    expect(res.body.message).toBe("Asignaciones de clientes actualizadas.")
    expect(service.remove).toHaveBeenCalledWith(1, 2)
})
test("returns service errors without a successful response", async () => {
    ;(service.assign as jest.Mock).mockRejectedValue(new AppError(422, "errors.assignment_client_missing"))
    const res = await request(app).put("/api/salespeople/1/clients").set("Authorization", `Bearer ${token(permissions)}`).send({ clientIds: [99] })
    expect(res.status).toBe(422)
})
