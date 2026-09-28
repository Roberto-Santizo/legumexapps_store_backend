jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/productIngredient.service", () => ({
    productIngredientService: {
        listProductIngredients: jest.fn(),
        getProductIngredientById: jest.fn(),
        createProductIngredient: jest.fn(),
        updateProductIngredient: jest.fn(),
        deleteProductIngredient: jest.fn(),
    }
}))
jest.mock("../services/productIngredientImport.service", () => ({
    productIngredientImportService: {
        bulkImportProductIngredients: jest.fn(),
        buildProductIngredientImportTemplate: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import productIngredientRouter from "./productIngredient.routes"
import { productIngredientService } from "../services/productIngredient.service"
import { productIngredientImportService } from "../services/productIngredientImport.service"

const app = buildTestApp("/api/product-ingredients", productIngredientRouter)

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

describe("productIngredientRouter (HTTP) — carga masiva de Ingredientes por producto (paso 3)", () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it("POST /bulk-import sin token -> 401", async () => {
        const res = await request(app).post("/api/product-ingredients/bulk-import")
        expect(res.status).toBe(401)
    })

    it("POST /bulk-import con solo 'products:view' -> 403", async () => {
        const res = await request(app)
            .post("/api/product-ingredients/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:view"])}`)
            .attach("file", Buffer.from("x"), { filename: "ingredientes.xlsx", contentType: XLSX_MIME })

        expect(res.status).toBe(403)
        expect(productIngredientImportService.bulkImportProductIngredients).not.toHaveBeenCalled()
    })

    it("POST /bulk-import con un archivo que no es Excel -> 422", async () => {
        const res = await request(app)
            .post("/api/product-ingredients/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)
            .attach("file", Buffer.from("hola"), { filename: "ingredientes.txt", contentType: "text/plain" })

        expect(res.status).toBe(422)
        expect(productIngredientImportService.bulkImportProductIngredients).not.toHaveBeenCalled()
    })

    it("POST /bulk-import con 'products:edit' y un .xlsx -> 201 con la cantidad creada", async () => {
        (productIngredientImportService.bulkImportProductIngredients as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])

        const res = await request(app)
            .post("/api/product-ingredients/bulk-import")
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)
            .attach("file", Buffer.from("x"), { filename: "ingredientes.xlsx", contentType: XLSX_MIME })

        expect(res.status).toBe(201)
        expect(res.body.data).toEqual({ created: 3 })
    })

    it("GET /bulk-import/template se resuelve antes que /:id y devuelve el Excel", async () => {
        (productIngredientImportService.buildProductIngredientImportTemplate as jest.Mock).mockResolvedValue(Buffer.from("xlsx"))

        const res = await request(app)
            .get("/api/product-ingredients/bulk-import/template")
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)

        expect(res.status).toBe(200)
        expect(res.headers["content-disposition"]).toContain("plantilla-ingredientes-producto.xlsx")
        expect(productIngredientService.getProductIngredientById).not.toHaveBeenCalled()
    })
})

describe("productIngredientRouter (HTTP) — CRUD", () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it("POST / sin gramos o sin peso de referencia -> 400 sin llegar al servicio", async () => {
        const res = await request(app)
            .post("/api/product-ingredients")
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)
            .send({ productId: 1, ingredientId: 2, grams: 40 })

        expect(res.status).toBe(400)
        expect(productIngredientService.createProductIngredient).not.toHaveBeenCalled()
    })

    it("POST / con 'products:view' -> 403", async () => {
        const res = await request(app)
            .post("/api/product-ingredients")
            .set("Authorization", `Bearer ${staffToken(["products:view"])}`)
            .send({ productId: 1, ingredientId: 2, grams: 40, referenceNetWeightGrams: 2000 })

        expect(res.status).toBe(403)
    })

    it("POST / válido con 'products:edit' -> 201", async () => {
        (productIngredientService.createProductIngredient as jest.Mock).mockResolvedValue({ id: 1 })

        const res = await request(app)
            .post("/api/product-ingredients")
            .set("Authorization", `Bearer ${staffToken(["products:edit"])}`)
            .send({ productId: 1, ingredientId: 2, grams: 40, referenceNetWeightGrams: 2000 })

        expect(res.status).toBe(201)
        expect(productIngredientService.createProductIngredient).toHaveBeenCalledWith({ productId: 1, ingredientId: 2, grams: 40, referenceNetWeightGrams: 2000 })
    })
})
