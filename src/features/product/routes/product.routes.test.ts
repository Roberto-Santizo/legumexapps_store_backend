jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/product.service", () => ({
    productService: {
        listProducts: jest.fn(),
        getProductById: jest.fn(),
        createProduct: jest.fn(),
        updateProduct: jest.fn(),
        deleteProduct: jest.fn(),
        setProductStatus: jest.fn(),
    }
}))
jest.mock("../services/productImport.service", () => ({
    productImportService: {
        bulkImportProducts: jest.fn(),
        buildProductImportTemplate: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import productRouter from "./product.routes"
import { productService } from "../services/product.service"
import { productImportService } from "../services/productImport.service"

const app = buildTestApp("/api/products", productRouter)

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

describe("productRouter (HTTP) — carga masiva de Productos (2026-09-25)", () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it("POST /bulk-import sin token -> 401", async () => {
        const res = await request(app).post("/api/products/bulk-import")
        expect(res.status).toBe(401)
    })

    it("POST /bulk-import con 'products:edit' (no 'products:create') -> 403, mismo permiso que el formulario de crear", async () => {
        const res = await request(app)
            .post("/api/products/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)
            .attach("file", Buffer.from("x"), { filename: "productos.xlsx", contentType: XLSX_MIME })

        expect(res.status).toBe(403)
        expect(productImportService.bulkImportProducts).not.toHaveBeenCalled()
    })

    it("POST /bulk-import con 'products:create' pero sin archivo -> 422", async () => {
        const res = await request(app)
            .post("/api/products/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)

        expect(res.status).toBe(422)
        expect(productImportService.bulkImportProducts).not.toHaveBeenCalled()
    })

    it("POST /bulk-import con un archivo que no es Excel -> 422", async () => {
        const res = await request(app)
            .post("/api/products/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)
            .attach("file", Buffer.from("hola"), { filename: "productos.txt", contentType: "text/plain" })

        expect(res.status).toBe(422)
        expect(productImportService.bulkImportProducts).not.toHaveBeenCalled()
    })

    it("POST /bulk-import con 'products:create' y un .xlsx -> 201 con la cantidad creada", async () => {
        (productImportService.bulkImportProducts as jest.Mock).mockResolvedValue({ products: 1, variants: 2 })

        const res = await request(app)
            .post("/api/products/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)
            .attach("file", Buffer.from("x"), { filename: "productos.xlsx", contentType: XLSX_MIME })

        expect(res.status).toBe(201)
        expect(res.body.data).toEqual({ created: 2, productsCreated: 1, variantsCreated: 2 })
    })

    it("GET /bulk-import/template se resuelve antes que /:id y devuelve el Excel", async () => {
        (productImportService.buildProductImportTemplate as jest.Mock).mockResolvedValue(Buffer.from("xlsx"))

        const res = await request(app)
            .get("/api/products/bulk-import/template")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)

        expect(res.status).toBe(200)
        expect(res.headers["content-disposition"]).toContain("plantilla-productos.xlsx")
        expect(productService.getProductById).not.toHaveBeenCalled()
    })

    it("GET /bulk-import/template sin 'products:create' -> 403", async () => {
        const res = await request(app)
            .get("/api/products/bulk-import/template")
            .set("Authorization", `Bearer ${staffToken(["products:view"])}`)

        expect(res.status).toBe(403)
    })
})
