jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/rawMaterialTransformation.service", () => ({
    rawMaterialTransformationService: {
        listTransformations: jest.fn(),
        getTransformationById: jest.fn(),
        listSources: jest.fn(),
        previewTransformation: jest.fn(),
        createTransformation: jest.fn(),
        updateTransformation: jest.fn(),
        recalculateTransformation: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import router from "./rawMaterialTransformation.routes"
import { rawMaterialTransformationService as service } from "../services/rawMaterialTransformation.service"
import { AppError } from "../../../shared/errors/AppError"

const app = buildTestApp("/api/raw-material-transformations", router)
const token = (permissions: string[]) => `Bearer ${jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")}`
const ALL = ["rawMaterialTransformations:view", "rawMaterialTransformations:create", "rawMaterialTransformations:edit"]

const calculation = {
    inputCostPerPound: 0.52, inputCurrency: "GTQ", freightPerPound: 0, freightCurrency: "GTQ",
    yieldPercentage: 45, exchangeRate: 7.65,
    costs: [{ category: "packaging", conceptName: "Bolsa", amount: 0.83, currency: "GTQ", costBasis: "per_unit", poundsPerUnit: 20 }],
}
const body = {
    unprocessedCode: "BAN-001", unprocessedName: "Banano", processedCode: "BAN-P-001", processedName: "Banano procesado",
    ingredientType: "fruit", ...calculation,
}
const detail = { id: 7, processedCode: "BAN-P-001", processedCostUsd: 0.226686851649 }

beforeEach(() => jest.resetAllMocks())

describe("rawMaterialTransformationRouter (HTTP)", () => {
    test("401 without a token and with a salesperson token", async () => {
        expect((await request(app).get("/api/raw-material-transformations")).status).toBe(401)
        const salesperson = jwt.sign({ sub: 1, type: "customer" }, "test-secret")
        expect((await request(app).get("/api/raw-material-transformations").set("Authorization", `Bearer ${salesperson}`)).status).toBe(401)
    })

    test("403 for staff with only raw material permissions", async () => {
        const res = await request(app).get("/api/raw-material-transformations").set("Authorization", token(["rawMaterials:view", "rawMaterials:edit"]))
        expect(res.status).toBe(403)
        expect(service.listTransformations).not.toHaveBeenCalled()
    })

    test("view can list (with search/pagination), read, list sources and preview, but not create or edit", async () => {
        (service.listTransformations as jest.Mock).mockResolvedValue({ data: [] });
        (service.getTransformationById as jest.Mock).mockResolvedValue(detail);
        (service.listSources as jest.Mock).mockResolvedValue([]);
        (service.previewTransformation as jest.Mock).mockReturnValue({ processedCostUsd: 1 })
        const view = token(["rawMaterialTransformations:view"])
        expect((await request(app).get("/api/raw-material-transformations?page=2&search=ban").set("Authorization", view)).status).toBe(200)
        expect(service.listTransformations).toHaveBeenCalledWith({ page: 2, limit: undefined }, "ban")
        expect((await request(app).get("/api/raw-material-transformations/7").set("Authorization", view)).status).toBe(200)
        expect((await request(app).get("/api/raw-material-transformations/sources").set("Authorization", view)).status).toBe(200)
        expect(service.getTransformationById).toHaveBeenCalledTimes(1)
        expect((await request(app).post("/api/raw-material-transformations/preview").set("Authorization", view).send(calculation)).status).toBe(200)
        expect((await request(app).post("/api/raw-material-transformations").set("Authorization", view).send(body)).status).toBe(403)
        expect((await request(app).put("/api/raw-material-transformations/7").set("Authorization", view).send(body)).status).toBe(403)
        expect((await request(app).post("/api/raw-material-transformations/7/recalculate").set("Authorization", view)).status).toBe(403)
        expect(service.createTransformation).not.toHaveBeenCalled()
    })

    test("create returns 201 with the processed code and final cost in the message", async () => {
        (service.createTransformation as jest.Mock).mockResolvedValue(detail)
        const res = await request(app).post("/api/raw-material-transformations").set("Authorization", token(ALL)).send(body)
        expect(res.status).toBe(201)
        expect(res.body.data).toEqual(detail)
        expect(res.body.message).toContain("BAN-P-001")
        expect(res.body.message).toContain("0.2267")
        expect(service.createTransformation).toHaveBeenCalledWith(expect.objectContaining({ processedCode: "BAN-P-001", costs: calculation.costs }))
    })

    test("the client can never send a final cost: unknown keys are rejected (strict)", async () => {
        for (const extra of [{ processedCostUsd: 0.01 }, { costPerUnit: 0.01 }, { catalogCostPerPound: 1 }]) {
            const res = await request(app).post("/api/raw-material-transformations").set("Authorization", token(ALL)).send({ ...body, ...extra })
            expect(res.status).toBe(400)
        }
        const line = { ...calculation.costs[0], costUsdPerProcessedPound: 9 }
        expect((await request(app).post("/api/raw-material-transformations/preview").set("Authorization", token(ALL)).send({ ...calculation, costs: [line] })).status).toBe(400)
        expect(service.createTransformation).not.toHaveBeenCalled()
    })

    test.each([
        ["yield 0", { yieldPercentage: 0 }],
        ["yield over 100", { yieldPercentage: 101 }],
        ["negative input cost", { inputCostPerPound: -1 }],
        ["exchange rate 0", { exchangeRate: 0 }],
        ["unknown currency", { inputCurrency: "EUR" }],
        ["unknown category", { costs: [{ ...calculation.costs[0], category: "taxes" }] }],
        ["blank concept", { costs: [{ ...calculation.costs[0], conceptName: "  " }] }],
        ["missing processed code", { processedCode: "" }],
        ["unknown raw material type", { ingredientType: "meat" }],
    ])("400 for %s", async (_label, change) => {
        const res = await request(app).post("/api/raw-material-transformations").set("Authorization", token(ALL)).send({ ...body, ...change })
        expect(res.status).toBe(400)
    })

    test("update and recalculate need edit and pass the id", async () => {
        (service.updateTransformation as jest.Mock).mockResolvedValue(detail);
        (service.recalculateTransformation as jest.Mock).mockResolvedValue(detail)
        expect((await request(app).put("/api/raw-material-transformations/7").set("Authorization", token(ALL)).send(body)).status).toBe(200)
        expect(service.updateTransformation).toHaveBeenCalledWith(7, expect.objectContaining({ unprocessedCode: "BAN-001" }))
        expect((await request(app).post("/api/raw-material-transformations/7/recalculate").set("Authorization", token(ALL))).status).toBe(200)
        expect(service.recalculateTransformation).toHaveBeenCalledWith(7)
        expect((await request(app).put("/api/raw-material-transformations/abc").set("Authorization", token(ALL)).send(body)).status).toBe(400)
    })

    test("business errors come back translated with their status", async () => {
        (service.createTransformation as jest.Mock).mockRejectedValue(new AppError(409, "errors.raw_material_code_already_exists", { code: "BAN-P-001" }))
        const res = await request(app).post("/api/raw-material-transformations").set("Authorization", token(ALL)).send(body)
        expect(res.status).toBe(409)
        expect(res.body.message).toContain("BAN-P-001")
    })
})
