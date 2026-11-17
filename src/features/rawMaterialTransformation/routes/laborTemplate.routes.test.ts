jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" } }))
jest.mock("../services/laborImport.service", () => ({ laborImportService: { template: jest.fn(), plan: jest.fn(), confirm: jest.fn() } }))
jest.mock("../services/laborTemplate.service", () => ({ laborTemplateService: {
    reference: jest.fn(), listLines: jest.fn(), saveLine: jest.fn(), list: jest.fn(), get: jest.fn(), revisions: jest.fn(), save: jest.fn(), preview: jest.fn(),
} }))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./laborTemplate.routes"
import { laborTemplateService as service } from "../services/laborTemplate.service"
import { getLaborReference } from "../services/laborTemplateReference"
import { laborImportService } from "../services/laborImport.service"

const app = buildTestApp("/api/labor-templates", router)
const base = "/api/labor-templates"
const token = (permissions: string[], type = "staff") => `Bearer ${jwt.sign({ sub: 1, type, roleId: 1, roleName: "Admin", permissions }, "test-secret")}`
const view = () => token(["laborTemplates:view"])
const reference = getLaborReference()
const calculation = { ...reference.settings, positions: reference.example.positions }
const body = { ...calculation, code: "TEST", displayName: "Test", lineCode: "1LNDTA", isActive: true, effectiveFrom: "2024-01-01", changeReason: "Reference", expectedVersion: 0 }

beforeEach(() => jest.resetAllMocks())

test("requires active staff and a labor permission, independently of PCS permissions", async () => {
    expect((await request(app).get(`${base}/reference`)).status).toBe(401)
    expect((await request(app).get(`${base}/reference`).set("Authorization", token(["laborTemplates:view"], "customer"))).status).toBe(401)
    expect((await request(app).get(`${base}/reference`).set("Authorization", token(["rawMaterialTransformations:view"]))).status).toBe(403)
    expect(service.reference).not.toHaveBeenCalled()
})

test("HR workbook download and both import steps require create permission", async () => {
    for (const path of ["/bulk-import/template", "/bulk-import/preview", "/bulk-import/confirm"]) {
        const method = path.endsWith("template") ? "get" : "post"
        expect((await request(app)[method](`${base}${path}`)).status).toBe(401)
        expect((await request(app)[method](`${base}${path}`).set("Authorization", view())).status).toBe(403)
        expect((await request(app)[method](`${base}${path}`).set("Authorization", token(["laborTemplates:create"], "customer"))).status).toBe(401)
    }
    expect(laborImportService.plan).not.toHaveBeenCalled()
    expect(laborImportService.confirm).not.toHaveBeenCalled()
})

test("HR import returns a downloadable workbook and rejects missing or wrong file extensions", async () => {
    ;(laborImportService.template as jest.Mock).mockResolvedValue(Buffer.from("synthetic workbook"))
    const auth = token(["laborTemplates:create"])
    const response = await request(app).get(`${base}/bulk-import/template`).set("Authorization", auth)
    expect(response.status).toBe(200)
    expect(response.headers["content-disposition"]).toContain("plantilla-rrhh-sueldos.xlsx")
    expect(response.headers["content-type"]).toContain("spreadsheetml")
    expect((await request(app).post(`${base}/bulk-import/preview`).set("Authorization", auth)).status).toBe(422)
    expect((await request(app).post(`${base}/bulk-import/preview`).set("Authorization", auth).attach("file", Buffer.from("xlsx"), "data.xls")).status).toBe(422)
    expect(laborImportService.plan).not.toHaveBeenCalled()
})

test("confirmation derives the author from the authenticated session, without trusting workbook authors", async () => {
    ;(laborImportService.confirm as jest.Mock).mockResolvedValue({ created: 2, positions: 4 })
    const hash = "a".repeat(64)
    const result = await request(app).post(`${base}/bulk-import/confirm`).set("Authorization", token(["laborTemplates:create"]))
        .field("previewHash", hash).attach("file", Buffer.from("synthetic"), "data.xlsx")
    expect(result.status).toBe(201)
    expect(laborImportService.confirm).toHaveBeenCalledWith(Buffer.from("synthetic"), hash, 1)
})

test("view can read references, lines, saved templates, historical versions and preview", async () => {
    for (const path of ["/reference", "/lines", "/", "/7", "/7/revisions", "/7/revisions/1"]) {
        expect((await request(app).get(`${base}${path}`).set("Authorization", view())).status).toBe(200)
    }
    expect(service.get).toHaveBeenCalledWith(7, 1)
    expect((await request(app).post(`${base}/preview`).set("Authorization", view()).send(calculation)).status).toBe(200)
    expect(service.save).not.toHaveBeenCalled()
    expect((await request(app).post(base).set("Authorization", view()).send(body)).status).toBe(403)
    expect((await request(app).put(`${base}/7`).set("Authorization", view()).send(body)).status).toBe(403)
    expect((await request(app).delete(`${base}/7` ).set("Authorization", view())).status).toBe(404)
})

test("create and edit have distinct permissions and derive the author from the session", async () => {
    ;(service.save as jest.Mock).mockResolvedValue({ id: 7 })
    expect((await request(app).post(base).set("Authorization", token(["laborTemplates:create"])).send(body)).status).toBe(201)
    expect(service.save).toHaveBeenCalledWith(undefined, body, 1)
    expect((await request(app).put(`${base}/7`).set("Authorization", token(["laborTemplates:create"])).send(body)).status).toBe(403)
    expect((await request(app).put(`${base}/7`).set("Authorization", token(["laborTemplates:edit"])).send(body)).status).toBe(200)
    expect(service.save).toHaveBeenCalledWith(7, body, 1)
})

test.each([{ total: 1 }, { hourlyCostGtq: 1 }, { createdByUserId: 99 }, { exchangeRate: 7.5 }, { yieldPercentage: 80 }])("rejects forbidden derived fields and out-of-scope data %j", async extra => {
    expect((await request(app).post(base).set("Authorization", token(["laborTemplates:create"])).send({ ...body, ...extra })).status).toBe(400)
    expect(service.save).not.toHaveBeenCalled()
})

test("rejects invalid positions, hours and benefit selections before calling the service", async () => {
    for (const patch of [{ weeklyHours: 0 }, { positions: [...body.positions, body.positions[0]] }, { positions: [{ ...body.positions[0], applicableBenefitCodes: ["NO"] }] }, { positions: [] }]) {
        expect((await request(app).post(`${base}/preview`).set("Authorization", view()).send({ ...calculation, ...patch })).status).toBe(400)
    }
    expect(service.preview).not.toHaveBeenCalled()
})
