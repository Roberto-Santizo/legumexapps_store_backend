jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret" } }))
jest.mock("../services/clientImport.service", () => ({ clientImportService: { bulkImportClients: jest.fn(), buildClientImportTemplate: jest.fn() } }))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import { BulkImportError } from "../../../shared/errors/AppError"
import clientImportRouter from "./clientImport.routes"
import { clientImportService } from "../services/clientImport.service"

const app = buildTestApp("/admin/clients", clientImportRouter)
const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const auth = (permissions: string[], type = "staff") => `Bearer ${jwt.sign({ sub: 1, type, permissions, roleId: 1, roleName: "Admin" }, "test-secret")}`
const creator = auth(["clients:create"])
const upload = (language = "es") => request(app).post("/admin/clients/bulk-import").set("Authorization", creator).set("Accept-Language", language)
beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(clientImportService.buildClientImportTemplate).mockResolvedValue(Buffer.from("xlsx"))
    jest.mocked(clientImportService.bulkImportClients).mockResolvedValue([{ id: 1, name: "ACME" }] as never)
})

describe("client import endpoints", () => {
    test("both endpoints require staff authentication and clients:create", async () => {
        for (const [method, path] of [["get", "/admin/clients/bulk-import/template"], ["post", "/admin/clients/bulk-import"]] as const) {
            expect((await request(app)[method](path)).status).toBe(401)
            expect((await request(app)[method](path).set("Authorization", auth(["clients:create"], "customer"))).status).toBe(401)
            for (const permissions of [["clients:view"], ["clients:edit"], ["salespeople:create"]]) {
                expect((await request(app)[method](path).set("Authorization", auth(permissions))).status).toBe(403)
            }
        }
        expect(clientImportService.bulkImportClients).not.toHaveBeenCalled()
        expect(clientImportService.buildClientImportTemplate).not.toHaveBeenCalled()
    })
    test("downloads the template as an Excel attachment", async () => {
        const response = await request(app).get("/admin/clients/bulk-import/template").set("Authorization", creator)
        expect(response.status).toBe(200)
        expect(response.headers["content-type"]).toContain(mime)
        expect(response.headers["content-disposition"]).toContain("plantilla-clientes.xlsx")
    })
    test("translates workbook instructions into the request language", async () => {
        const response = await request(app).get("/admin/clients/bulk-import/template").set("Authorization", creator).set("Accept-Language", "en")
        expect(response.status).toBe(200)
        expect(clientImportService.buildClientImportTemplate).toHaveBeenCalledWith([
            expect.stringContaining("Name is the only field"),
            expect.stringContaining("Repeated names are allowed"),
            expect.stringContaining("example row"),
        ])
    })
    test("rejects missing file, wrong MIME and oversize uploads before parsing", async () => {
        expect((await upload()).status).toBe(422)
        expect((await upload().attach("file", Buffer.from("csv"), { filename: "file.csv", contentType: "text/csv" })).status).toBe(422)
        expect((await upload().attach("file", Buffer.alloc(5 * 1024 * 1024 + 1), { filename: "big.xlsx", contentType: mime })).status).toBe(422)
        expect(clientImportService.bulkImportClients).not.toHaveBeenCalled()
    })
    test("forwards bytes and returns created count in the shared panel format", async () => {
        const buffer = Buffer.from("workbook")
        const response = await upload().attach("file", buffer, { filename: "clients.xlsx", contentType: mime })
        expect(response.status).toBe(201)
        expect(response.body.data).toEqual({ created: 1 })
        expect(clientImportService.bulkImportClients).toHaveBeenCalledWith(buffer)
    })
    test.each(["es", "en"])("returns translated row, field and reason in %s", async language => {
        jest.mocked(clientImportService.bulkImportClients).mockRejectedValue(new BulkImportError([
            { row: 3, field: "name", key: "errors.client_import_name_too_small" },
            { row: 4, field: "name", key: "errors.client_import_name_too_big" },
            { row: 5, field: "name", key: "errors.client_import_name_invalid_type" },
        ]))
        const response = await upload(language).attach("file", Buffer.from("xlsx"), { filename: "clients.xlsx", contentType: mime })
        expect(response.status).toBe(422)
        expect(response.body.details).toHaveLength(3)
        for (const detail of response.body.details) {
            expect(detail.field).toBe("name")
            expect(detail.message).toContain(language === "es" ? "Nombre" : "Name")
            expect(detail.message).not.toContain("errors.")
        }
    })
})
