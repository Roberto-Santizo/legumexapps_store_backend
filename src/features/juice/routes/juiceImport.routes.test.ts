jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret" } }))
jest.mock("../services/juiceCatalog.service", () => {
    const service = () => ({ list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), setStatus: jest.fn() })
    return { juiceService: service(), juiceRawMaterialService: service(), juicePresentationService: service(), juiceMixService: service(), juiceSpiceMaterialService: service(), juiceSpiceService: service() }
})
jest.mock("../services/juiceConfig.service", () => ({ juiceConfigService: {} }))
jest.mock("../services/juiceImport.service", () => ({ bulkImportJuices: jest.fn(), buildJuiceImportTemplate: jest.fn() }))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import { BulkImportError } from "../../../shared/errors/AppError"
import router from "./juice.routes"
import { bulkImportJuices, buildJuiceImportTemplate } from "../services/juiceImport.service"

const app = buildTestApp("/admin/juices", router)
const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const auth = (permissions: string[], type = "staff") => `Bearer ${jwt.sign({ sub: 1, type, permissions, roleId: 1, roleName: "Admin" }, "test-secret")}`
const creator = auth(["juices:create"])
beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(buildJuiceImportTemplate).mockResolvedValue(Buffer.from("xlsx"))
    jest.mocked(bulkImportJuices).mockResolvedValue({ rawMaterials: 3, spiceMaterials: 1, juices: 1, mixRows: 3, spiceRows: 1, presentations: 1, globalRevision: 2, clientOverrideIds: [] })
})

describe("juice import HTTP contract", () => {
    test("requires staff token and create permission for both endpoints", async () => {
        expect((await request(app).get("/admin/juices/bulk-import/template")).status).toBe(401)
        expect((await request(app).get("/admin/juices/bulk-import/template").set("Authorization", auth(["juices:create"], "customer"))).status).toBe(401)
        expect((await request(app).get("/admin/juices/bulk-import/template").set("Authorization", auth(["juices:view"]))).status).toBe(403)
        expect((await request(app).post("/admin/juices/bulk-import").set("Authorization", auth(["juiceConfig:edit"]))).status).toBe(403)
        expect(bulkImportJuices).not.toHaveBeenCalled()
    })
    test("template literal route precedes /:id and serves an xlsx attachment", async () => {
        const response = await request(app).get("/admin/juices/bulk-import/template").set("Authorization", creator)
        expect(response.status).toBe(200)
        expect(response.headers["content-type"]).toContain(mime)
        expect(response.headers["content-disposition"]).toContain("plantilla-jugos-fijos.xlsx")
        expect(buildJuiceImportTemplate).toHaveBeenCalledTimes(1)
    })
    test("missing file and wrong file MIME fail before service calls", async () => {
        expect((await request(app).post("/admin/juices/bulk-import").set("Authorization", creator)).status).toBe(422)
        expect((await request(app).post("/admin/juices/bulk-import").set("Authorization", creator).attach("file", Buffer.from("csv"), { filename: "file.csv", contentType: "text/csv" })).status).toBe(422)
        expect(bulkImportJuices).not.toHaveBeenCalled()
    })
    test("forwards workbook bytes and returns counts for every imported table", async () => {
        const buffer = Buffer.from("workbook-bytes")
        const response = await request(app).post("/admin/juices/bulk-import").set("Authorization", creator).attach("file", buffer, { filename: "jugos.xlsx", contentType: mime })
        expect(response.status).toBe(201)
        expect(response.body.data).toMatchObject({ created: 10, rawMaterials: 3, spiceMaterials: 1, juices: 1, presentations: 1 })
        expect(bulkImportJuices).toHaveBeenCalledWith(buffer)
    })
    test("translates sheet-aware row errors through the existing error pipeline", async () => {
        jest.mocked(bulkImportJuices).mockRejectedValue(new BulkImportError([{ row: 8, field: "% MP!C.GI", key: "errors.juice_import_reference", params: { value: "GI" } }]))
        const response = await request(app).post("/admin/juices/bulk-import").set("Authorization", creator).set("Accept-Language", "es").attach("file", Buffer.from("file"), { filename: "jugos.xlsx", contentType: mime })
        expect(response.status).toBe(422)
        expect(response.body.details[0]).toMatchObject({ row: 8, field: "% MP!C.GI" })
        expect(response.body.details[0].message).toContain("GI")
        expect(response.body.details[0].message).not.toContain("errors.")
    })
    test("enforces the shared 5 MiB upload limit", async () => {
        const response = await request(app).post("/admin/juices/bulk-import").set("Authorization", creator).attach("file", Buffer.alloc(5 * 1024 * 1024 + 1), { filename: "big.xlsx", contentType: mime })
        expect(response.status).toBe(422)
        expect(bulkImportJuices).not.toHaveBeenCalled()
    })
})
