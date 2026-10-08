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
        previewProductImport: jest.fn(),
        confirmProductImport: jest.fn(),
        buildProductImportTemplate: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import ExcelJS from "exceljs"
import { writeWorkbookToBuffer } from "../../../shared/utils/excelImport.util"
import { productController } from "../controllers/Product.controller"
import type { Request, Response } from "express"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import productRouter from "./product.routes"
import { productService } from "../services/product.service"
import { productImportService } from "../services/productImport.service"

const app = buildTestApp("/api/products", productRouter)

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
let validBuffer: Buffer
beforeAll(async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet("Productos y Variantes").addRow(["SKU"])
    validBuffer = await writeWorkbookToBuffer(workbook)
})

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
            .attach("file", validBuffer, { filename: "productos.xlsx", contentType: XLSX_MIME })

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
            .attach("file", validBuffer, { filename: "productos.xlsx", contentType: XLSX_MIME })

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


describe("carga inicial conjunta HTTP", () => {
    beforeEach(() => jest.clearAllMocks())
    it.each([undefined, "serialized buffer", new ArrayBuffer(8), Buffer.alloc(0)])("controller rejects missing or incorrect buffer %p", async buffer => {
        const next = jest.fn()
        const req = { file: { originalname: "productos.xlsx", mimetype: XLSX_MIME, size: 8, buffer } } as unknown as Request
        await productController.previewImport(req, {} as Response, next)
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422, key: "errors.bulk_import_invalid_xlsx" }))
        expect(productImportService.previewProductImport).not.toHaveBeenCalled()
    })
    it("controller rejects inconsistent multer size metadata", async () => {
        const next = jest.fn()
        const req = { file: { originalname: "productos.xlsx", mimetype: XLSX_MIME, size: validBuffer.length + 1, buffer: validBuffer } } as unknown as Request
        await productController.previewImport(req, {} as Response, next)
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }))
        expect(productImportService.previewProductImport).not.toHaveBeenCalled()
    })
    it("preview rejects multipart without file", async () => {
        const response = await request(app).post("/api/products/bulk-import/preview")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`).field("name", "productos.xlsx")
        expect(response.status).toBe(422)
        expect(productImportService.previewProductImport).not.toHaveBeenCalled()
    })
    it.each([
        ["empty.xlsx", XLSX_MIME, Buffer.alloc(0)],
        ["fake.xlsx", XLSX_MIME, Buffer.from("not an Excel file")],
        ["legacy.xls", XLSX_MIME, Buffer.from("PK\x03\x04")],
        ["fake.xlsx", "text/plain", Buffer.from("PK\x03\x04")],
    ])("preview rejects %s (%s)", async (filename, contentType, buffer) => {
        const response = await request(app).post("/api/products/bulk-import/preview")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)
            .attach("file", buffer, { filename, contentType })
        expect(response.status).toBe(422)
        expect(response.body.message).toContain(".xlsx")
        expect(productImportService.previewProductImport).not.toHaveBeenCalled()
    })
    it("preview accepts generic MIME and preserves the complete buffer", async () => {
        (productImportService.previewProductImport as jest.Mock).mockResolvedValue({ issues: [], materials: [] })
        const response = await request(app).post("/api/products/bulk-import/preview")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)
            .attach("file", validBuffer, { filename: "productos.xlsx", contentType: "application/octet-stream" })
        expect(response.status).toBe(200)
        expect(productImportService.previewProductImport).toHaveBeenCalledWith(validBuffer)
    })
    it("preview rejects files exceeding multer's size limit", async () => {
        const response = await request(app).post("/api/products/bulk-import/preview")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)
            .attach("file", Buffer.alloc(5 * 1024 * 1024 + 1), { filename: "big.xlsx", contentType: XLSX_MIME })
        expect(response.status).toBe(422)
        expect(productImportService.previewProductImport).not.toHaveBeenCalled()
    })
    it.each(["preview", "confirm"])("%s requiere permiso products:create", async endpoint => {
        const response = await request(app).post(`/api/products/bulk-import/${endpoint}`)
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)
            .attach("file", validBuffer, { filename: "productos.xlsx", contentType: XLSX_MIME })
        expect(response.status).toBe(403)
    })
    it("preview devuelve las dos hojas sin llamar al importador", async () => {
        const preview = { previewHash: "a".repeat(64), summary: { products: 1, variants: 1, unit: 0, intermediate: 0, pallet: 1, errors: 0, warnings: 0 }, products: [{ skuCode: "NEW" }], materials: [{ quantity: 1, quantityBasis: "per_box", issues: [], warnings: [] }], issues: [] }
        ;(productImportService.previewProductImport as jest.Mock).mockResolvedValue(preview)
        const response = await request(app).post("/api/products/bulk-import/preview")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)
            .attach("file", validBuffer, { filename: "productos.xlsx", contentType: XLSX_MIME })
        expect(response.status).toBe(200)
        expect(response.body.data.summary).toEqual(preview.summary)
        expect(response.body.data.products).toEqual(preview.products)
        expect(response.body.data.materials[0].consumptionRule).toBeDefined()
        expect(productImportService.bulkImportProducts).not.toHaveBeenCalled()
        expect(productImportService.confirmProductImport).not.toHaveBeenCalled()
    })
    it("confirm pasa el hash y responde con todos los conteos", async () => {
        const summary = { products: 1, variants: 1, unit: 1, intermediate: 0, pallet: 1, errors: 0, warnings: 0 }
        ;(productImportService.confirmProductImport as jest.Mock).mockResolvedValue(summary)
        const response = await request(app).post("/api/products/bulk-import/confirm")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)
            .field("previewHash", "a".repeat(64))
            .attach("file", validBuffer, { filename: "productos.xlsx", contentType: XLSX_MIME })
        expect(response.status).toBe(201)
        expect(response.body.data).toEqual(summary)
        expect(productImportService.confirmProductImport).toHaveBeenCalledWith(expect.any(Buffer), "a".repeat(64))
    })
    it("conflicto de serialización exige nuevo preview", async () => {
        (productImportService.confirmProductImport as jest.Mock).mockRejectedValue({ original: { code: "40001" } })
        const response = await request(app).post("/api/products/bulk-import/confirm")
            .set("Authorization", `Bearer ${staffToken(["products:create"])}`)
            .field("previewHash", "a".repeat(64))
            .attach("file", validBuffer, { filename: "productos.xlsx", contentType: XLSX_MIME })
        expect(response.status).toBe(409)
    })
})
