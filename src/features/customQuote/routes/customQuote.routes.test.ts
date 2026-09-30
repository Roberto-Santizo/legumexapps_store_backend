jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/customQuote.service", () => ({
    customQuoteService: { calculateCustomQuote: jest.fn(), saveCustomQuote: jest.fn() }
}))
jest.mock("../services/customQuoteCatalog.service", () => ({
    customQuoteCatalogService: { getCatalog: jest.fn() }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import customQuoteRouter from "./customQuote.routes"
import { customQuoteService } from "../services/customQuote.service"
import { customQuoteCatalogService } from "../services/customQuoteCatalog.service"
import { AppError } from "../../../shared/errors/AppError"

const app = buildTestApp("/api/custom-quotes", customQuoteRouter)

// El JWT del representante sigue llevando type "customer" (ver CLAUDE.md §8, renombre a salesperson).
const SALESPERSON = `Bearer ${jwt.sign({ sub: 42, type: "customer" }, "test-secret")}`
const STAFF = `Bearer ${jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions: ["customQuoteConfig:edit", "quotes:calculate"] }, "test-secret")}`

const VALID_BODY = {
    subCategoryId: 3,
    presentationId: 7,
    rawMaterialMix: [{ rawMaterialId: 1, percentage: 60 }, { rawMaterialId: 2, percentage: 40 }],
    requestedPallets: 2,
}

const calculate = customQuoteService.calculateCustomQuote as jest.Mock
const getCatalog = customQuoteCatalogService.getCatalog as jest.Mock
const save = customQuoteService.saveCustomQuote as jest.Mock

describe("customQuoteRouter -- autenticación", () => {
    it.each([
        ["GET", "/api/custom-quotes/catalog"],
        ["POST", "/api/custom-quotes/preview"],
    ])("%s %s sin token -> 401", async (method, path) => {
        const res = method === "GET" ? await request(app).get(path) : await request(app).post(path).send(VALID_BODY)
        expect(res.status).toBe(401)
    })

    it("un token de staff (aunque tenga permisos de configuración) no sirve -> 401", async () => {
        const res = await request(app).post("/api/custom-quotes/preview").set("Authorization", STAFF).send(VALID_BODY)
        expect(res.status).toBe(401)
        expect(calculate).not.toHaveBeenCalled()
    })
})

describe("GET /catalog", () => {
    it("devuelve el menú en el idioma del pedido", async () => {
        getCatalog.mockResolvedValue({ categories: [], ingredients: [], presentations: [], packaging: {} })

        const res = await request(app).get("/api/custom-quotes/catalog").set("Authorization", SALESPERSON).set("Accept-Language", "en")

        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({ categories: [], ingredients: [], presentations: [], packaging: {} })
        expect(getCatalog).toHaveBeenCalledWith("en")
    })
})

describe("POST /preview", () => {
    it("calcula con el cuerpo validado (defaults aplicados) y devuelve el cálculo", async () => {
        calculate.mockResolvedValue({ totalCost: 1234.5 })

        const res = await request(app).post("/api/custom-quotes/preview").set("Authorization", SALESPERSON).send(VALID_BODY)

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ data: { totalCost: 1234.5 } })
        expect(calculate).toHaveBeenCalledWith({ ...VALID_BODY, ingredients: [], isOrganic: false }, "es")
    })

    it.each([
        ["un costo en el cuerpo", { ...VALID_BODY, totalCost: 1 }],
        ["cuentas de palet del cliente", { ...VALID_BODY, boxesPerPallet: 99 }],
        ["un costo dentro de una línea de la mezcla", { ...VALID_BODY, rawMaterialMix: [{ rawMaterialId: 1, percentage: 100, unitCost: 0 }] }],
        ["una cantidad dentro de un ingrediente", { ...VALID_BODY, ingredients: [{ ingredientId: 30, gramsPerUnit: 5, quantity: 3 }] }],
    ])("es estricto: rechaza %s -> 400 sin calcular", async (_label, body) => {
        const res = await request(app).post("/api/custom-quotes/preview").set("Authorization", SALESPERSON).send(body)
        expect(res.status).toBe(400)
        expect(calculate).not.toHaveBeenCalled()
    })

    it.each([
        ["mezcla vacía", { ...VALID_BODY, rawMaterialMix: [] }],
        ["más de 10 materias primas", { ...VALID_BODY, rawMaterialMix: Array.from({ length: 11 }, (_, index) => ({ rawMaterialId: index + 1, percentage: 1 })) }],
        ["más de 10 ingredientes", { ...VALID_BODY, ingredients: Array.from({ length: 11 }, (_, index) => ({ ingredientId: index + 1, gramsPerUnit: 1 })) }],
        ["porcentaje en 0", { ...VALID_BODY, rawMaterialMix: [{ rawMaterialId: 1, percentage: 0 }] }],
        ["gramos negativos", { ...VALID_BODY, ingredients: [{ ingredientId: 30, gramsPerUnit: -1 }] }],
        ["palets fraccionados", { ...VALID_BODY, requestedPallets: 1.5 }],
        ["ids de empaque que no son un arreglo", { ...VALID_BODY, selectedPalletPackagingOptionIds: 7 }],
        ["sin presentación", { ...VALID_BODY, presentationId: undefined }],
    ])("rechaza %s -> 400", async (_label, body) => {
        const res = await request(app).post("/api/custom-quotes/preview").set("Authorization", SALESPERSON).send(body)
        expect(res.status).toBe(400)
        expect(calculate).not.toHaveBeenCalled()
    })

    it("un error de negocio del motor se devuelve traducido", async () => {
        calculate.mockRejectedValue(new AppError(422, "errors.custom_quote_presentation_not_offered", { presentationId: 7 }))

        const res = await request(app)
            .post("/api/custom-quotes/preview")
            .set("Authorization", SALESPERSON)
            .set("Accept-Language", "es")
            .send(VALID_BODY)

        expect(res.status).toBe(422)
        expect(JSON.stringify(res.body)).toContain("no está disponible para cotizaciones a la medida")
    })
})

describe("POST / (guardar)", () => {
    it("sin token -> 401, sin guardar", async () => {
        const res = await request(app).post("/api/custom-quotes").send(VALID_BODY)
        expect(res.status).toBe(401)
        expect(save).not.toHaveBeenCalled()
    })

    it("un token de staff no puede guardar -> 401", async () => {
        const res = await request(app).post("/api/custom-quotes").set("Authorization", STAFF).send(VALID_BODY)
        expect(res.status).toBe(401)
        expect(save).not.toHaveBeenCalled()
    })

    it("201: guarda a nombre del representante del JWT, con el cuerpo validado y el idioma", async () => {
        save.mockResolvedValue({ id: 77, status: "new", totalCost: 1234.5 })

        const res = await request(app)
            .post("/api/custom-quotes")
            .set("Authorization", SALESPERSON)
            .set("Accept-Language", "en")
            .send(VALID_BODY)

        expect(res.status).toBe(201)
        expect(res.body.data).toEqual({ id: 77, status: "new", totalCost: 1234.5 })
        expect(res.body.message).toEqual(expect.any(String))
        expect(save).toHaveBeenCalledWith(42, { ...VALID_BODY, ingredients: [], isOrganic: false }, "en")
        expect(calculate).not.toHaveBeenCalled()
    })

    it("mismo contrato estricto que el preview: un costo o un salespersonId en el cuerpo -> 400", async () => {
        for (const body of [{ ...VALID_BODY, totalCost: 1 }, { ...VALID_BODY, salespersonId: 1 }, { ...VALID_BODY, clientId: 1 }]) {
            const res = await request(app).post("/api/custom-quotes").set("Authorization", SALESPERSON).send(body)
            expect(res.status).toBe(400)
        }
        expect(save).not.toHaveBeenCalled()
    })

    it("un error de negocio del motor se devuelve tal cual (422)", async () => {
        save.mockRejectedValue(new AppError(422, "errors.custom_quote_presentation_not_offered", { presentationId: 7 }))

        const res = await request(app).post("/api/custom-quotes").set("Authorization", SALESPERSON).send(VALID_BODY)

        expect(res.status).toBe(422)
    })

    it("el preview sigue sin guardar", async () => {
        calculate.mockResolvedValue({ totalCost: 1 })

        await request(app).post("/api/custom-quotes/preview").set("Authorization", SALESPERSON).send(VALID_BODY)

        expect(save).not.toHaveBeenCalled()
    })
})
