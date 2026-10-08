jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret" } }))
jest.mock("../services/packagingGroup.service", () => ({ packagingGroupService: {
    list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), status: jest.fn(),
} }))
import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./packagingGroup.routes"
import { packagingGroupService as service } from "../services/packagingGroup.service"
const app = buildTestApp("/api/packaging-groups", router)
const token = (permissions: string[]) => jwt.sign({ sub: 1, type: "staff", permissions }, "test-secret")
const row = { id: 4, displayName: "Caja", isActive: true }

describe("packaging group routes", () => {
    beforeEach(() => { jest.clearAllMocks(); jest.mocked(service.list).mockResolvedValue([row] as never); jest.mocked(service.create).mockResolvedValue(row as never) })
    it("requires staff authentication", async () => {
        expect((await request(app).get("/api/packaging-groups")).status).toBe(401)
    })
    it("does not give product editors catalog write permissions", async () => {
        expect((await request(app).post("/api/packaging-groups").set("Authorization", `Bearer ${token(["products:edit"])}`).send({ displayName: "Caja" })).status).toBe(403)
    })
    it("provides selector options to product editors without catalog view permissions", async () => {
        const result = await request(app).get("/api/packaging-groups/options").set("Authorization", `Bearer ${token(["products:edit"])}`)
        expect(result.status).toBe(200)
        expect(result.body.data).toEqual([row])
    })
    it("creates with the dedicated permission and rejects blank names", async () => {
        const auth = `Bearer ${token(["packagingGroups:create"])}`
        expect((await request(app).post("/api/packaging-groups").set("Authorization", auth).send({ displayName: " " })).status).toBe(400)
        expect((await request(app).post("/api/packaging-groups").set("Authorization", auth).send({ displayName: "Caja" })).status).toBe(201)
        expect(service.create).toHaveBeenCalledWith("Caja")
    })
    it("has no physical delete endpoint", async () => {
        expect((await request(app).delete("/api/packaging-groups/4").set("Authorization", `Bearer ${token(["packagingGroups:delete"])}`)).status).toBe(404)
    })
})
