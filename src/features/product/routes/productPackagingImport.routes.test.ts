jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" } }))
jest.mock("../services/productPackagingImport.service", () => ({ productPackagingImportService: {
    previewProductPackagingImport: jest.fn(), confirmProductPackagingImport: jest.fn(), buildProductPackagingImportTemplate: jest.fn(),
} }))
import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./productPackagingImport.routes"
import { productPackagingImportService as service } from "../services/productPackagingImport.service"
import { BulkImportError } from "../../../shared/errors/AppError"

const app = buildTestApp("/api/product-packaging-materials", router)
const root = "/api/product-packaging-materials/bulk-import"
const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const token = (permissions = ["products:edit"]) => jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
const summary = { total: 1, new: 1, update: 0, unchanged: 0, error: 0 }
const upload = (action: string, filename = "materials.xlsx", contentType = mime) => request(app).post(`${root}/${action}`).set("Authorization", `Bearer ${token()}`).attach("file", Buffer.from("xlsx"), { filename, contentType })

beforeEach(() => jest.resetAllMocks())
it.each(["preview", "confirm"])("requires authentication and edit permission for %s", async action => {
    expect((await request(app).post(`${root}/${action}`)).status).toBe(401)
    expect((await request(app).post(`${root}/${action}`).set("Authorization", `Bearer ${token(["products:view"])}`)).status).toBe(403)
    expect(service.previewProductPackagingImport).not.toHaveBeenCalled()
    expect(service.confirmProductPackagingImport).not.toHaveBeenCalled()
})
it("returns a localized row preview without writing", async () => {
    jest.mocked(service.previewProductPackagingImport).mockResolvedValue({ previewHash: "a".repeat(64), summary,
        rows: [{ row: 2, skuCode: "SKU", packagingCode: "MISSING", materialName: "", quantityPerPallet: null, ruleSource: null, level: null, group: null, isDefault: false, quantityBasis: null, quantity: null, unitCost: null, action: "error", previous: null,
            issues: [{ row: 2, field: "packagingCode", key: "errors.packaging_association_import.unknown_packaging", params: { code: "MISSING" } }], warnings: [] }],
    })
    const res = await upload("preview")
    expect(res.status).toBe(200)
    expect(res.body.data.rows[0].issues[0].message).toContain("MISSING")
    expect(res.body.data.rows[0].issues[0].message).not.toContain("errors.")
    expect(service.confirmProductPackagingImport).not.toHaveBeenCalled()
})
it("passes the original uploaded file and preview hash to confirmation", async () => {
    jest.mocked(service.confirmProductPackagingImport).mockResolvedValue(summary)
    const hash = "a".repeat(64)
    const res = await request(app).post(`${root}/confirm`).set("Authorization", `Bearer ${token()}`).field("previewHash", hash).attach("file", Buffer.from("xlsx"), { filename: "materials.xlsx", contentType: mime })
    expect(res.status).toBe(200)
    expect(service.confirmProductPackagingImport).toHaveBeenCalledWith(Buffer.from("xlsx"), hash)
    expect(res.body.data).toEqual(summary)
})
it("returns all row issues when confirmation is blocked", async () => {
    jest.mocked(service.confirmProductPackagingImport).mockRejectedValue(new BulkImportError([{ row: 18, field: "skuCode", key: "errors.packaging_association_import.unknown_sku", params: { code: "PTC404" } }]))
    const res = await upload("confirm")
    expect(res.status).toBe(422)
    expect(res.body.details[0]).toMatchObject({ row: 18, field: "skuCode" })
    expect(res.body.details[0].message).toContain("PTC404")
})
it.each([["materials.txt", "text/plain"], ["materials.xls", "application/vnd.ms-excel"], ["materials.xlsx", "text/plain"]])("rejects unsupported file %s / %s", async (filename, contentType) => {
    expect((await upload("preview", filename, contentType)).status).toBe(422)
    expect(service.previewProductPackagingImport).not.toHaveBeenCalled()
})
it("rejects missing and oversized files", async () => {
    expect((await request(app).post(`${root}/preview`).set("Authorization", `Bearer ${token()}`)).status).toBe(422)
    const res = await request(app).post(`${root}/preview`).set("Authorization", `Bearer ${token()}`).attach("file", Buffer.alloc(5 * 1024 * 1024 + 1), { filename: "large.xlsx", contentType: mime })
    expect(res.status).toBe(422)
    expect(service.previewProductPackagingImport).not.toHaveBeenCalled()
})
it("downloads the actual template endpoint with translated instructions", async () => {
    jest.mocked(service.buildProductPackagingImportTemplate).mockResolvedValue(Buffer.from("xlsx"))
    const res = await request(app).get(`${root}/template`).set("Authorization", `Bearer ${token()}`)
    expect(res.status).toBe(200)
    expect(res.headers["content-disposition"]).toContain("plantilla-materiales-por-variante.xlsx")
    const instructions = jest.mocked(service.buildProductPackagingImportTemplate).mock.calls[0][0]!
    expect(instructions.join(" ")).toContain("USD")
    expect(instructions.join(" ")).not.toContain("packagingAssociationImport.instructions")
})
it("returns a conflict for a serializable concurrent edit", async () => {
    jest.mocked(service.confirmProductPackagingImport).mockRejectedValue({ original: { code: "40001" } })
    expect((await upload("confirm")).status).toBe(409)
})

it.each([["per_box", 1, "1 por caja"], ["per_pallet", 4, "4 por pallet"], ["per_pallet", 93.3, "93.3 por pallet"]])("returns friendly consumption %s/%s", async (basis, quantity, label) => {
    jest.mocked(service.previewProductPackagingImport).mockResolvedValue({ previewHash: "a".repeat(64), summary, rows: [{
        row: 2, skuCode: "SKU", packagingCode: "MP", materialName: "Catalog name", level: "pallet", group: null, isDefault: false,
        quantityBasis: String(basis), quantity: Number(quantity), quantityPerPallet: basis === "per_box" ? 198 : Number(quantity), ruleSource: "catalog", unitCost: 1,
        action: "new", previous: null, issues: [], warnings: [],
    }] })
    const res = await upload("preview")
    expect(res.status).toBe(200)
    expect(res.body.data.rows[0]).toMatchObject({ materialName: "Catalog name", consumptionRule: label })
    expect(res.body.data.rows[0].consumptionRule).not.toMatch(/per_box|per_pallet/)
})
