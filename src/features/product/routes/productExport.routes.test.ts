jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" } }))
jest.mock("../services/product.service", () => ({ productService: {} }))
jest.mock("../services/productImport.service", () => ({ productImportService: {} }))
jest.mock("../services/productExport.service", () => ({ productExportService: { exportProductCatalog: jest.fn() } }))
import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./product.routes"
import { productExportService } from "../services/productExport.service"
const app = buildTestApp("/api/products", router)
const token = (permissions: string[]) => `Bearer ${jwt.sign({ sub: 1, type: "staff", permissions }, "test-secret")}`
it("requires authentication and products:view before accessing export data", async () => {
    expect((await request(app).get("/api/products/export")).status).toBe(401)
    expect((await request(app).get("/api/products/export").set("Authorization", token(["products:create"]))).status).toBe(403)
    expect(productExportService.exportProductCatalog).not.toHaveBeenCalled()
})
it("downloads XLSX through the named route rather than interpreting export as a product ID", async () => {
    (productExportService.exportProductCatalog as jest.Mock).mockResolvedValue(Buffer.from("xlsx"))
    const response = await request(app).get("/api/products/export").set("Authorization", token(["products:view"]))
    expect(response.status).toBe(200)
    expect(response.headers["content-type"]).toContain("spreadsheetml.sheet")
    expect(response.headers["content-disposition"]).toMatch(/attachment; filename="catalogo-productos-.*\.xlsx"/)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(productExportService.exportProductCatalog).toHaveBeenCalledTimes(1)
})
