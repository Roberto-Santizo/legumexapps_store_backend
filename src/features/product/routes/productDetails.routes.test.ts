jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret" } }))
jest.mock("../services/product.service", () => ({ productService: {} }))
jest.mock("../services/productImport.service", () => ({ productImportService: {} }))
jest.mock("../controllers/productExport.controller", () => ({ exportProductCatalog: jest.fn() }))
jest.mock("../services/productDetails.service", () => ({ getFixedProductDetails: jest.fn() }))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./product.routes"
import { getFixedProductDetails } from "../services/productDetails.service"
import { NotFoundError } from "../../../shared/errors/AppError"

const app = buildTestApp("/api/products", router)
const token = (type: string, permissions: string[]) => jwt.sign({ sub: 1, type, permissions }, "test-secret")
const path = "/api/products/5/details"
beforeEach(() => jest.resetAllMocks())

test("detail is exclusively administrative and requires products:view", async () => {
    expect((await request(app).get(path)).status).toBe(401)
    expect((await request(app).get(path).set("Authorization", `Bearer ${token("customer", ["products:view"])}`)).status).toBe(401)
    expect((await request(app).get(path).set("Authorization", `Bearer ${token("staff", ["products:edit"])}`)).status).toBe(403)
    expect(getFixedProductDetails).not.toHaveBeenCalled()
})
test("authorized read returns real detail projection including inactive product", async () => {
    const details = { id: 5, isActive: false, displayName: "Original", productVariants: [{ skuCode: "REAL-STORED-SKU" }] }
    ;(getFixedProductDetails as jest.Mock).mockResolvedValue(details)
    const res = await request(app).get(path).set("Authorization", `Bearer ${token("staff", ["products:view"])}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(details)
    expect(getFixedProductDetails).toHaveBeenCalledWith(5)
})
test("invalid ID fails before querying and missing fixed product returns 404", async () => {
    const authorization = `Bearer ${token("staff", ["products:view"])}`
    expect((await request(app).get("/api/products/abc/details").set("Authorization", authorization)).status).toBe(400)
    expect(getFixedProductDetails).not.toHaveBeenCalled()
    ;(getFixedProductDetails as jest.Mock).mockRejectedValue(new NotFoundError("Product", 5))
    expect((await request(app).get(path).set("Authorization", authorization)).status).toBe(404)
})
test.each(["0", "2147483648", "9999999999999999999999"])("out-of-range ID %s is rejected before PostgreSQL", async id => {
    expect((await request(app).get(`/api/products/${id}/details`).set("Authorization", `Bearer ${token("staff", ["products:view"])}`)).status).toBe(400)
    expect(getFixedProductDetails).not.toHaveBeenCalled()
})
test.each(["post", "put", "patch", "delete"] as const)("detail path has no %s operation", async method => {
    expect((await request(app)[method](path).set("Authorization", `Bearer ${token("staff", ["products:view", "products:edit"])}`)).status).toBe(404)
    expect(getFixedProductDetails).not.toHaveBeenCalled()
})
