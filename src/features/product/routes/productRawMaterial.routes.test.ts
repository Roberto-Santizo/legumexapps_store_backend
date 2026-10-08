jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/productRawMaterial.service", () => ({
    productRawMaterialService: {
        listProductRawMaterials: jest.fn(),
        getProductRawMaterialById: jest.fn(),
        createProductRawMaterial: jest.fn(),
        updateProductRawMaterial: jest.fn(),
        deleteProductRawMaterial: jest.fn(),
    }
}))
jest.mock("../services/productRawMaterialImport.service", () => ({
    productRawMaterialImportService: {
        bulkImportProductRawMaterials: jest.fn(),
        buildProductRawMaterialImportTemplate: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import productRawMaterialRouter from "./productRawMaterial.routes"
import { productRawMaterialService } from "../services/productRawMaterial.service"
import { productRawMaterialImportService } from "../services/productRawMaterialImport.service"

const app = buildTestApp("/api/product-raw-materials", productRawMaterialRouter)

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

describe("productRawMaterialRouter (HTTP) — carga masiva de Recetas (2026-09-25)", () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it("POST /bulk-import sin token -> 401", async () => {
        const res = await request(app).post("/api/product-raw-materials/bulk-import")
        expect(res.status).toBe(401)
    })

    it("POST /bulk-import con solo 'products:view' -> 403", async () => {
        const res = await request(app)
            .post("/api/product-raw-materials/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:view"])}`)
            .attach("file", Buffer.from("x"), { filename: "recetas.xlsx", contentType: XLSX_MIME })

        expect(res.status).toBe(403)
        expect(productRawMaterialImportService.bulkImportProductRawMaterials).not.toHaveBeenCalled()
    })

    it("POST /bulk-import con un archivo que no es Excel -> 422", async () => {
        const res = await request(app)
            .post("/api/product-raw-materials/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)
            .attach("file", Buffer.from("hola"), { filename: "recetas.txt", contentType: "text/plain" })

        expect(res.status).toBe(422)
        expect(productRawMaterialImportService.bulkImportProductRawMaterials).not.toHaveBeenCalled()
    })

    it("POST /bulk-import con 'products:edit' y un .xlsx -> 201 con la cantidad creada", async () => {
        (productRawMaterialImportService.bulkImportProductRawMaterials as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])

        const res = await request(app)
            .post("/api/product-raw-materials/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)
            .attach("file", Buffer.from("x"), { filename: "recetas.xlsx", contentType: XLSX_MIME })

        expect(res.status).toBe(201)
        expect(res.body.data).toEqual({ created: 3 })
    })

    it("GET /bulk-import/template se resuelve antes que /:id y devuelve el Excel", async () => {
        (productRawMaterialImportService.buildProductRawMaterialImportTemplate as jest.Mock).mockResolvedValue(Buffer.from("xlsx"))

        const res = await request(app)
            .get("/api/product-raw-materials/bulk-import/template")
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)

        expect(res.status).toBe(200)
        expect(res.headers["content-disposition"]).toContain("plantilla-recetas.xlsx")
        expect(productRawMaterialService.getProductRawMaterialById).not.toHaveBeenCalled()
    })
})
