jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/customQuoteRawMaterialOption.service", () => ({
    customQuoteRawMaterialOptionService: {
        listRawMaterialOptions: jest.fn(),
        getRawMaterialOptionById: jest.fn(),
        createRawMaterialOption: jest.fn(),
        updateRawMaterialOption: jest.fn(),
        setRawMaterialOptionStatus: jest.fn(),
    }
}))
jest.mock("../services/customQuoteIngredientOption.service", () => ({
    customQuoteIngredientOptionService: {
        listIngredientOptions: jest.fn(),
        getIngredientOptionById: jest.fn(),
        createIngredientOption: jest.fn(),
        updateIngredientOption: jest.fn(),
        setIngredientOptionStatus: jest.fn(),
    }
}))
jest.mock("../services/customQuotePresentationOption.service", () => ({
    customQuotePresentationOptionService: {
        listPresentationOptions: jest.fn(),
        getPresentationOptionById: jest.fn(),
        createPresentationOption: jest.fn(),
        updatePresentationOption: jest.fn(),
        setPresentationOptionStatus: jest.fn(),
    }
}))
jest.mock("../services/customQuotePackagingOption.service", () => ({
    customQuotePackagingOptionService: {
        listPackagingOptions: jest.fn(),
        getPackagingOptionById: jest.fn(),
        createPackagingOption: jest.fn(),
        updatePackagingOption: jest.fn(),
        setPackagingOptionStatus: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import customQuoteConfigRouter from "./customQuoteConfig.routes"
import { customQuoteRawMaterialOptionService } from "../services/customQuoteRawMaterialOption.service"
import { customQuoteIngredientOptionService } from "../services/customQuoteIngredientOption.service"
import { customQuotePresentationOptionService } from "../services/customQuotePresentationOption.service"
import { customQuotePackagingOptionService } from "../services/customQuotePackagingOption.service"

const BASE = "/api/admin/custom-quote-config"
const app = buildTestApp(BASE, customQuoteConfigRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

const CONFIG_TOKEN = `Bearer ${staffToken(["customQuoteConfig:edit"])}`

const LIST_MOCKS = [
    { path: "/raw-material-options", list: customQuoteRawMaterialOptionService.listRawMaterialOptions },
    { path: "/ingredient-options", list: customQuoteIngredientOptionService.listIngredientOptions },
    { path: "/presentation-options", list: customQuotePresentationOptionService.listPresentationOptions },
    { path: "/packaging-options", list: customQuotePackagingOptionService.listPackagingOptions },
]

beforeEach(() => {
    for (const { list } of LIST_MOCKS) (list as jest.Mock).mockResolvedValue([])
})

describe("customQuoteConfigRouter -- permisos", () => {
    it("sin token -> 401", async () => {
        const res = await request(app).get(`${BASE}/raw-material-options`)
        expect(res.status).toBe(401)
    })

    it("token de representante (no staff) -> 401", async () => {
        const salespersonToken = jwt.sign({ sub: 1, type: "customer" }, "test-secret")
        const res = await request(app).get(`${BASE}/raw-material-options`).set("Authorization", `Bearer ${salespersonToken}`)
        expect(res.status).toBe(401)
    })

    it.each([["quotes:calculate"], ["quotes:view"], ["products:edit"]])(
        "staff con solo '%s' -> 403 en las cuatro listas, sin llegar al servicio",
        async (permission) => {
            for (const { path, list } of LIST_MOCKS) {
                const res = await request(app).get(`${BASE}${path}`).set("Authorization", `Bearer ${staffToken([permission])}`)
                expect(res.status).toBe(403)
                expect(list).not.toHaveBeenCalled()
            }
        }
    )

    it("escribir también exige customQuoteConfig:edit", async () => {
        const res = await request(app)
            .post(`${BASE}/ingredient-options`)
            .set("Authorization", `Bearer ${staffToken(["ingredients:create"])}`)
            .send({ ingredientId: 4 })
        expect(res.status).toBe(403)
        expect(customQuoteIngredientOptionService.createIngredientOption).not.toHaveBeenCalled()
    })

    it("con customQuoteConfig:edit las cuatro listas responden 200", async () => {
        for (const { path, list } of LIST_MOCKS) {
            const res = await request(app).get(`${BASE}${path}`).set("Authorization", CONFIG_TOKEN)
            expect(res.status).toBe(200)
            expect(res.body).toEqual({ data: [] })
            expect(list).toHaveBeenCalled()
        }
    })
})

describe("customQuoteConfigRouter -- validación y cableado", () => {
    it("materias primas: filtra por subcategoría (número); un valor no numérico -> 400", async () => {
        await request(app).get(`${BASE}/raw-material-options?subCategoryId=3`).set("Authorization", CONFIG_TOKEN)
        expect(customQuoteRawMaterialOptionService.listRawMaterialOptions).toHaveBeenCalledWith(3)

        const res = await request(app).get(`${BASE}/raw-material-options?subCategoryId=abc`).set("Authorization", CONFIG_TOKEN)
        expect(res.status).toBe(400)
    })

    it("empaques: filtra por nivel; un nivel desconocido -> 400", async () => {
        await request(app).get(`${BASE}/packaging-options?level=pallet`).set("Authorization", CONFIG_TOKEN)
        expect(customQuotePackagingOptionService.listPackagingOptions).toHaveBeenCalledWith("pallet")

        const res = await request(app).get(`${BASE}/packaging-options?level=box`).set("Authorization", CONFIG_TOKEN)
        expect(res.status).toBe(400)
    })

    it("id no numérico -> 400", async () => {
        const res = await request(app).get(`${BASE}/ingredient-options/abc`).set("Authorization", CONFIG_TOKEN)
        expect(res.status).toBe(400)
        expect(customQuoteIngredientOptionService.getIngredientOptionById).not.toHaveBeenCalled()
    })

    it("crear materia prima sin rawMaterialId -> 400; completa -> 201 con min/max por defecto en null", async () => {
        const bad = await request(app).post(`${BASE}/raw-material-options`).set("Authorization", CONFIG_TOKEN).send({ subCategoryId: 3 })
        expect(bad.status).toBe(400)

        ;(customQuoteRawMaterialOptionService.createRawMaterialOption as jest.Mock).mockResolvedValue({ id: 1 })
        const res = await request(app)
            .post(`${BASE}/raw-material-options`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ subCategoryId: 3, rawMaterialId: 7 })

        expect(res.status).toBe(201)
        expect(res.body.data).toEqual({ id: 1 })
        expect(customQuoteRawMaterialOptionService.createRawMaterialOption).toHaveBeenCalledWith({
            subCategoryId: 3, rawMaterialId: 7, minPercentage: null, maxPercentage: null
        })
    })

    it("crear materia prima con porcentaje fuera de 0-100 -> 400", async () => {
        const res = await request(app)
            .post(`${BASE}/raw-material-options`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ subCategoryId: 3, rawMaterialId: 7, maxPercentage: 120 })
        expect(res.status).toBe(400)
    })

    it("editar materia prima exige las dos claves (null = sin límite)", async () => {
        const res = await request(app)
            .patch(`${BASE}/raw-material-options/1`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ minPercentage: 10 })
        expect(res.status).toBe(400)
        expect(customQuoteRawMaterialOptionService.updateRawMaterialOption).not.toHaveBeenCalled()
    })

    it("presentación: cajas por palet en 0 -> 400; sin nivel intermedio llega null al servicio", async () => {
        const bad = await request(app)
            .post(`${BASE}/presentation-options`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ presentationId: 2, boxesPerPallet: 0, bagsPerBox: 12 })
        expect(bad.status).toBe(400)

        ;(customQuotePresentationOptionService.createPresentationOption as jest.Mock).mockResolvedValue({ id: 1 })
        const res = await request(app)
            .post(`${BASE}/presentation-options`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ presentationId: 2, boxesPerPallet: 40, bagsPerBox: 12 })
        expect(res.status).toBe(201)
        expect(customQuotePresentationOptionService.createPresentationOption).toHaveBeenCalledWith({
            presentationId: 2, boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: null
        })
    })

    it("editar presentación exige las cuentas de palet", async () => {
        const res = await request(app)
            .patch(`${BASE}/presentation-options/1`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ bagsPerBox: 12, unitsPerIntermediatePackage: null })
        expect(res.status).toBe(400)
    })

    it("editar empaque: un grupo omitido llega como null (fila fija), mismo contrato que los materiales del SKU", async () => {
        ;(customQuotePackagingOptionService.updatePackagingOption as jest.Mock).mockResolvedValue({ id: 1 })

        const res = await request(app)
            .patch(`${BASE}/packaging-options/1`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ quantity: 2 })

        expect(res.status).toBe(200)
        expect(customQuotePackagingOptionService.updatePackagingOption).toHaveBeenCalledWith(1, {
            quantity: 2, quantityBasis: null, optionGroup: null, isDefault: false
        })
    })

    it("empaque con base de cantidad desconocida -> 400", async () => {
        const res = await request(app)
            .post(`${BASE}/packaging-options`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ packagingId: 5, quantity: 1, quantityBasis: "per_kg" })
        expect(res.status).toBe(400)
    })

    it("estado: reenvía isActive; sin booleano -> 400", async () => {
        ;(customQuoteIngredientOptionService.setIngredientOptionStatus as jest.Mock).mockResolvedValue({ id: 1, isActive: false })

        const res = await request(app)
            .patch(`${BASE}/ingredient-options/1/status`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ isActive: false })
        expect(res.status).toBe(200)
        expect(customQuoteIngredientOptionService.setIngredientOptionStatus).toHaveBeenCalledWith(1, false)

        const bad = await request(app)
            .patch(`${BASE}/ingredient-options/1/status`)
            .set("Authorization", CONFIG_TOKEN)
            .send({ isActive: "no" })
        expect(bad.status).toBe(400)
    })

    it("un error del servicio (409) se devuelve traducido", async () => {
        const { AppError } = await import("../../../shared/errors/AppError")
        ;(customQuoteIngredientOptionService.createIngredientOption as jest.Mock)
            .mockRejectedValue(new AppError(409, "errors.custom_quote_option_already_exists"))

        const res = await request(app)
            .post(`${BASE}/ingredient-options`)
            .set("Authorization", CONFIG_TOKEN)
            .set("Accept-Language", "es")
            .send({ ingredientId: 4 })

        expect(res.status).toBe(409)
        expect(JSON.stringify(res.body)).toContain("configuración de cotizaciones a la medida")
    })
})
