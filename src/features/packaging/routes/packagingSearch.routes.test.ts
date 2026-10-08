jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-search-secret", jwtExpiresIn: "1h" } }))
jest.mock("../models/Packaging.model", () => ({ __esModule: true, default: { findAndCountAll: jest.fn() } }))
import request from "supertest"
import jwt from "jsonwebtoken"
import { Op } from "sequelize"
import Packaging from "../models/Packaging.model"
import router from "./packaging.routes"
import { buildTestApp } from "../../../shared/test-utils/testApp"

// Real route, query parser, controller, service and pagination; mock only DB I/O.
const app = buildTestApp("/api/packagings", router)
const token = jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Test", permissions: ["packagings:view"] }, "test-search-secret")
const material = { id: 83, code: "T-ME-AB083", displayName: "Tapa Para verde-Medio GALON", isActive: true }
const findAndCountAll = jest.mocked(Packaging.findAndCountAll)
beforeEach(() => jest.clearAllMocks())

it.each(["T-ME-AB083", "T-ME", "AB083", "ab083", "Tapa", "verde"])("preserves search %s through HTTP validation and applies name OR code before pagination", async search => {
    findAndCountAll.mockResolvedValue({ rows: [material], count: 1 } as never)
    const res = await request(app).get("/api/packagings").set("Authorization", `Bearer ${token}`).query({ page: 1, limit: 10, search })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([material])
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 })
    expect(findAndCountAll).toHaveBeenCalledWith({
        where: { isActive: true, [Op.or]: [
            { displayName: { [Op.iLike]: `%${search}%` } },
            { code: { [Op.iLike]: `%${search}%` } },
        ] },
        order: [["displayName", "DESC"]], limit: 10, offset: 0, distinct: true,
    })
})
it("returns zero results for NO-EXISTE", async () => {
    findAndCountAll.mockResolvedValue({ rows: [], count: 0 } as never)
    const res = await request(app).get("/api/packagings").set("Authorization", `Bearer ${token}`).query({ page: 1, search: "NO-EXISTE" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } })
    expect(findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: {
        isActive: true, [Op.or]: [{ displayName: { [Op.iLike]: "%NO-EXISTE%" } }, { code: { [Op.iLike]: "%NO-EXISTE%" } }],
    } }))
})
it("trims query whitespace, preserves hyphens and passes custom page/limit", async () => {
    findAndCountAll.mockResolvedValue({ rows: [material], count: 11 } as never)
    const res = await request(app).get("/api/packagings").set("Authorization", `Bearer ${token}`).query({ page: 2, limit: 5, search: "  T-ME  " })
    expect(res.status).toBe(200)
    expect(res.body.meta).toEqual({ page: 2, limit: 5, total: 11, totalPages: 3 })
    expect(findAndCountAll).toHaveBeenCalledWith({
        where: { isActive: true, [Op.or]: [{ displayName: { [Op.iLike]: "%T-ME%" } }, { code: { [Op.iLike]: "%T-ME%" } }] },
        order: [["displayName", "DESC"]], limit: 5, offset: 5, distinct: true,
    })
})
