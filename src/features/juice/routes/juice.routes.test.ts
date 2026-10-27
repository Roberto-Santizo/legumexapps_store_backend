jest.mock("../services/juiceProductLink.service", () => ({ linkJuiceProduct: jest.fn() }))
jest.mock("../services/juiceProductCreate.service", () => ({ createLinkedJuice: jest.fn() }))
jest.mock("../../../config/env", () => ({ env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" } }))
jest.mock("../services/juiceImport.service", () => ({ bulkImportJuices: jest.fn(), buildJuiceImportTemplate: jest.fn() }))
jest.mock("../services/juiceCatalog.service", () => {
    const service = () => ({ list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), setStatus: jest.fn() })
    return { juiceService: service(), juiceRawMaterialService: service(), juicePresentationService: service(), juiceMixService: service(), juiceSpiceMaterialService: service(), juiceSpiceService: service() }
})

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import { AppError } from "../../../shared/errors/AppError"
import router from "./juice.routes"
import * as catalog from "../services/juiceCatalog.service"
import { linkJuiceProduct } from "../services/juiceProductLink.service"
import { createLinkedJuice } from "../services/juiceProductCreate.service"

const app = buildTestApp("/admin/juices", router)
function token(permissions: string[], type = "staff") {
    return `Bearer ${jwt.sign({ sub: 1, type, roleId: 1, roleName: "Admin", permissions }, "test-secret")}`
}
const all = token(["juices:view", "juices:create", "juices:edit", "juices:delete"])
const juiceInput = { code: "CP", displayName: "Carrot Pineapple", clientId: 1 }
const routes = [
    ["", catalog.juiceService, juiceInput],
    ["/raw-materials", catalog.juiceRawMaterialService, { code: "C", displayName: "Carrot", purchaseUnit: "LIBRA", yieldPoundsPerLiter: 2.2, costPerUnit: 1 }],
    ["/presentations", catalog.juicePresentationService, { juiceId: 1, displayLabel: "6x354", mlPerBottle: 354, bottlesPerCase: 6, casesPerPallet: 100, boxUnitCost: 1, stickerUnitCost: 0, stickerQuantityPerCase: 0, secondStickerUnitCost: 0, secondStickerQuantityPerCase: 0, bottleUnitCost: 0.1, capUnitCost: 0.05 }],
    ["/mix", catalog.juiceMixService, { juiceId: 1, rawMaterialId: 2, percentage: 50 }],
    ["/spice-materials", catalog.juiceSpiceMaterialService, { code: "GINGER", displayName: "Ginger", costPerGram: 0.01 }],
    ["/spices", catalog.juiceSpiceService, { juiceId: 1, spiceMaterialId: 2, gramsPerLiter: 1 }],
] as const

describe("juice admin HTTP contract", () => {
    test("creation with category requires product creation permission and a valid subcategory", async () => {
        const path = "/admin/juices/with-product"
        const input = { ...juiceInput, subCategoryId: 2 }
        expect((await request(app).post(path).set("Authorization", token(["juices:create"])).send(input)).status).toBe(403)
        expect((await request(app).post(path).set("Authorization", token(["products:create"])).send(input)).status).toBe(403)
        expect(createLinkedJuice).not.toHaveBeenCalled()
        const authorized = token(["juices:create", "products:create"])
        expect((await request(app).post(path).set("Authorization", authorized).send(juiceInput)).status).toBe(400)
        jest.mocked(createLinkedJuice).mockResolvedValue({ id: 1, productId: 8 } as never)
        const response = await request(app).post(path).set("Authorization", authorized).send(input)
        expect(response.status).toBe(201)
        expect(response.body.data.productId).toBe(8)
        expect(createLinkedJuice).toHaveBeenCalledWith(input)
    })
    test("linking requires both juice editing and product creation, and validates the destination", async () => {
        jest.mocked(linkJuiceProduct).mockResolvedValue({ productId: 8, juiceId: 1 })
        const path = "/admin/juices/1/product"
        for (const permissions of [["juices:edit"], ["products:create"], []]) {
            expect((await request(app).post(path).set("Authorization", token(permissions)).send({ subCategoryId: 2 })).status).toBe(403)
        }
        expect(linkJuiceProduct).not.toHaveBeenCalled()
        const authorized = token(["juices:edit", "products:create"])
        expect((await request(app).post(path).set("Authorization", authorized).send({ subCategoryId: 0 })).status).toBe(400)
        expect((await request(app).post(path).set("Authorization", authorized).send({ subCategoryId: 2 })).status).toBe(201)
        expect(linkJuiceProduct).toHaveBeenCalledWith(1, 2)
    })
    test.each(routes)("catalog %s routes list/create/get and soft delete", async (path, service, input) => {
        jest.mocked(service.list).mockResolvedValue([{ id: 1 }])
        jest.mocked(service.create).mockResolvedValue({ id: 1, ...input })
        jest.mocked(service.get).mockResolvedValue({ id: 1 })
        jest.mocked(service.setStatus).mockResolvedValue({ id: 1, isActive: false })
        const base = `/admin/juices${path}`
        expect((await request(app).get(base).set("Authorization", all)).status).toBe(200)
        expect((await request(app).post(base).set("Authorization", all).send(input)).status).toBe(201)
        expect(service.create).toHaveBeenCalledWith(input)
        expect((await request(app).get(`${base}/1`).set("Authorization", all)).status).toBe(200)
        expect((await request(app).delete(`${base}/1`).set("Authorization", all)).status).toBe(200)
        expect(service.setStatus).toHaveBeenCalledWith(1, false)
    })
    test.each(routes)("catalog %s requires its respective permissions", async path => {
        const base = `/admin/juices${path}`
        expect((await request(app).get(base)).status).toBe(401)
        expect((await request(app).get(base).set("Authorization", token([], "customer"))).status).toBe(401)
        expect((await request(app).get(base).set("Authorization", token(["quotes:view"]))).status).toBe(403)
        expect((await request(app).post(base).set("Authorization", token(["juices:view"])).send({})).status).toBe(403)
        expect((await request(app).patch(`${base}/1`).set("Authorization", token(["juices:view"])).send({})).status).toBe(403)
        expect((await request(app).delete(`${base}/1`).set("Authorization", token(["juices:edit"]))).status).toBe(403)
    })
    test("validates payloads before services and keeps costing fields required on edits", async () => {
        expect((await request(app).post("/admin/juices").set("Authorization", all).send({ ...juiceInput, pricePerPound: 0 })).status).toBe(400)
        expect((await request(app).patch("/admin/juices/1").set("Authorization", all).send({ displayName: "New" })).status).toBe(400)
        expect((await request(app).get("/admin/juices/0").set("Authorization", all)).status).toBe(400)
        expect(catalog.juiceService.update).not.toHaveBeenCalled()
    })
    test("passes parsed filters and immutable mix update to service", async () => {
        await request(app).get("/admin/juices/mix?juiceId=2").set("Authorization", all)
        expect(catalog.juiceMixService.list).toHaveBeenCalledWith(2)
        expect((await request(app).patch("/admin/juices/mix/4").set("Authorization", all).send({ percentage: 60 })).status).toBe(200)
        expect(catalog.juiceMixService.update).toHaveBeenCalledWith(4, { percentage: 60 })
        expect((await request(app).patch("/admin/juices/mix/4").set("Authorization", all).send({ percentage: 60, rawMaterialId: 3 })).status).toBe(400)
    })
    test("surfaces a localized mix validation failure", async () => {
        jest.mocked(catalog.juiceMixService.create).mockRejectedValue(new AppError(422, "errors.juice_mix_ceiling", { total: "110" }))
        const response = await request(app).post("/admin/juices/mix").set("Authorization", all).set("Accept-Language", "es").send({ juiceId: 1, rawMaterialId: 2, percentage: 60 })
        expect(response.status).toBe(422)
        expect(JSON.stringify(response.body)).not.toContain("errors.juice_mix_ceiling")
        expect(catalog.juiceMixService.create).toHaveBeenCalled()
    })
    test("status and delete distinguish activation from deactivation", async () => {
        await request(app).patch("/admin/juices/1/status").set("Authorization", all).send({ isActive: true })
        expect(catalog.juiceService.setStatus).toHaveBeenCalledWith(1, true)
    })
})
