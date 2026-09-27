jest.mock("../models/ProductRawMaterial.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() }
}))
jest.mock("../models/Product.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
jest.mock("../../rawMaterial/models/RawMaterial.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))

import ProductRawMaterial from "../models/ProductRawMaterial.model"
import Product from "../models/Product.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import { productRawMaterialService } from "./productRawMaterial.service"

const mockProductFindOne = Product.findOne as unknown as jest.Mock
const mockRawMaterialFindOne = RawMaterial.findOne as unknown as jest.Mock
const mockCreate = ProductRawMaterial.create as unknown as jest.Mock
const mockFindAll = ProductRawMaterial.findAll as unknown as jest.Mock

describe("productRawMaterialService.createProductRawMaterial", () => {
    beforeEach(() => {
        mockFindAll.mockResolvedValue([]) // sin filas hermanas por defecto (ver assertFixedRecipePercentageCeiling)
    })

    describe("producto customizable (isCustomizable=true)", () => {
        beforeEach(() => {
            mockProductFindOne.mockResolvedValue({ isCustomizable: true })
        })

        it("rechaza una materia prima no mezclable (isMixable=false) en el pool de un producto personalizable", async () => {
            mockRawMaterialFindOne.mockResolvedValue({ isMixable: false })

            await expect(
                productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, minPercentage: 0, maxPercentage: 100 } as never)
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.raw_material_not_mixable" })
            expect(mockCreate).not.toHaveBeenCalled()
        })

        it("acepta una materia prima mezclable (isMixable=true)", async () => {
            mockRawMaterialFindOne.mockResolvedValue({ isMixable: true })
            mockCreate.mockResolvedValue({ id: 1 })

            await productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, minPercentage: 0, maxPercentage: 100 } as never)

            expect(mockCreate).toHaveBeenCalledTimes(1)
        })

        it("NO exige percentage en un producto customizable (usa min/maxPercentage en su lugar)", async () => {
            mockRawMaterialFindOne.mockResolvedValue({ isMixable: true })
            mockCreate.mockResolvedValue({ id: 1 })

            await productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: undefined } as never)

            expect(mockCreate).toHaveBeenCalledTimes(1)
        })
    })

    describe("producto de receta fija (isCustomizable=false)", () => {
        beforeEach(() => {
            mockProductFindOne.mockResolvedValue({ isCustomizable: false })
        })

        it("rechaza percentage vacío (bug histórico: la línea 'cuesta' $0 en cada cotización sin avisar)", async () => {
            await expect(
                productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: null } as never)
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.product_raw_material_percentage_required" })
        })

        it("rechaza percentage en 0", async () => {
            await expect(
                productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 0 } as never)
            ).rejects.toMatchObject({ key: "errors.product_raw_material_percentage_required" })
        })

        it("rechaza percentage negativo", async () => {
            await expect(
                productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: -5 } as never)
            ).rejects.toMatchObject({ key: "errors.product_raw_material_percentage_required" })
        })

        it("acepta percentage positivo y no exige que la materia prima sea mezclable", async () => {
            mockCreate.mockResolvedValue({ id: 1 })

            await productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 50 } as never)

            expect(mockCreate).toHaveBeenCalledTimes(1)
            // En receta fija ni siquiera se debería consultar isMixable -- la materia prima no se mezcla.
            expect(mockRawMaterialFindOne).not.toHaveBeenCalled()
        })
    })

    describe("techo blando de 100% en receta fija (assertFixedRecipePercentageCeiling)", () => {
        beforeEach(() => {
            mockProductFindOne.mockResolvedValue({ isCustomizable: false })
        })

        it("permite guardar una receta fija incompleta (< 100%) mientras se arma fila por fila", async () => {
            mockFindAll.mockResolvedValue([{ id: 1, percentage: 40 }]) // ya hay una fila activa al 40%
            mockCreate.mockResolvedValue({ id: 2 })

            await productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 30 } as never)

            expect(mockCreate).toHaveBeenCalledTimes(1)
        })

        it("acepta si la suma llega justo a 100", async () => {
            mockFindAll.mockResolvedValue([{ id: 1, percentage: 60 }])
            mockCreate.mockResolvedValue({ id: 2 })

            await productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 40 } as never)

            expect(mockCreate).toHaveBeenCalledTimes(1)
        })

        it("rechaza si la suma superaría 100% más allá de la tolerancia (±0.5)", async () => {
            mockFindAll.mockResolvedValue([{ id: 1, percentage: 60 }])

            await expect(
                productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 41 } as never)
            ).rejects.toMatchObject({ statusCode: 422, key: "errors.product_raw_material_percentage_ceiling_exceeded" })
            expect(mockCreate).not.toHaveBeenCalled()
        })

        it("solo suma filas activas de ESE producto (isActive: true en el where)", async () => {
            mockFindAll.mockResolvedValue([])
            mockCreate.mockResolvedValue({ id: 2 })

            await productRawMaterialService.createProductRawMaterial({ productId: 7, rawMaterialId: 9, percentage: 100 } as never)

            expect(mockFindAll).toHaveBeenCalledWith({ where: { productId: 7, isActive: true } })
        })
    })
})

describe("productRawMaterialService.createProductRawMaterial -- producto orgánico (Product.isOrganic)", () => {
    beforeEach(() => {
        mockProductFindOne.mockResolvedValue({ isOrganic: true, isCustomizable: false })
        mockFindAll.mockResolvedValue([])
    })

    it("rechaza una materia prima convencional (isOrganic=false, ingredientType='fruit') en un producto orgánico", async () => {
        mockRawMaterialFindOne.mockResolvedValue({ isMixable: true, isOrganic: false, ingredientType: "fruit" })

        await expect(
            productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 50 } as never)
        ).rejects.toMatchObject({ statusCode: 422, key: "errors.raw_material_not_organic_compatible" })
        expect(mockCreate).not.toHaveBeenCalled()
    })

    it("acepta la variante orgánica de una materia prima (isOrganic=true)", async () => {
        mockRawMaterialFindOne.mockResolvedValue({ isMixable: true, isOrganic: true, ingredientType: "fruit" })
        mockCreate.mockResolvedValue({ id: 1 })

        await productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 50 } as never)

        expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it("acepta un insumo tipo 'other' (agua, sal, azúcar...) aunque no esté marcado orgánico -- no tiene variante orgánica/convencional", async () => {
        mockRawMaterialFindOne.mockResolvedValue({ isMixable: true, isOrganic: false, ingredientType: "other" })
        mockCreate.mockResolvedValue({ id: 1 })

        await productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 50 } as never)

        expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it("no exige nada de esto si el producto NO es orgánico", async () => {
        mockProductFindOne.mockResolvedValue({ isOrganic: false, isCustomizable: false })
        mockCreate.mockResolvedValue({ id: 1 })

        await productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 50 } as never)

        expect(mockRawMaterialFindOne).not.toHaveBeenCalled()
        expect(mockCreate).toHaveBeenCalledTimes(1)
    })
})

describe("productRawMaterialService.updateProductRawMaterial", () => {
    beforeEach(() => {
        mockFindAll.mockResolvedValue([])
    })

    it("re-valida percentage contra el producto EFECTIVO (el nuevo productId del input, no el viejo) al editar", async () => {
        const existing = {
            id: 5,
            productId: 1,
            rawMaterialId: 9,
            percentage: 50,
            update: jest.fn().mockResolvedValue({ id: 5 }),
        }
        ;(ProductRawMaterial.findOne as unknown as jest.Mock).mockResolvedValue(existing)
        // Se está moviendo esta fila a productId=2, que resulta ser un producto de receta fija.
        mockProductFindOne.mockResolvedValue({ isCustomizable: false })

        await expect(
            productRawMaterialService.updateProductRawMaterial(5, { productId: 2, percentage: null } as never)
        ).rejects.toMatchObject({ key: "errors.product_raw_material_percentage_required" })
        expect(mockProductFindOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 } }))
    })

    it("si el input no manda percentage, revalida con el valor ya guardado (no lo trata como vacío)", async () => {
        const existing = {
            id: 5,
            productId: 1,
            rawMaterialId: 9,
            percentage: 50,
            update: jest.fn().mockResolvedValue({ id: 5 }),
        }
        ;(ProductRawMaterial.findOne as unknown as jest.Mock).mockResolvedValue(existing)
        mockProductFindOne.mockResolvedValue({ isCustomizable: false })

        await productRawMaterialService.updateProductRawMaterial(5, { displayOrder: 3 } as never)

        expect(existing.update).toHaveBeenCalledTimes(1)
    })

    it("excluye la propia fila del total al recalcular el techo de 100% (no se cuenta dos veces a sí misma)", async () => {
        const existing = {
            id: 5,
            productId: 1,
            rawMaterialId: 9,
            percentage: 50,
            update: jest.fn().mockResolvedValue({ id: 5 }),
        }
        ;(ProductRawMaterial.findOne as unknown as jest.Mock).mockResolvedValue(existing)
        mockProductFindOne.mockResolvedValue({ isCustomizable: false })
        // Solo la propia fila (id 5) está activa -- si se contara a sí misma además del nuevo
        // valor, 50 (vieja, sin excluir) + 60 (nueva) superaría 100 y esto rechazaría por error.
        mockFindAll.mockResolvedValue([{ id: 5, percentage: 50 }])

        await productRawMaterialService.updateProductRawMaterial(5, { percentage: 60 } as never)

        expect(existing.update).toHaveBeenCalledTimes(1)
    })

    it("rechaza si al editar, la suma con las demás filas activas superaría 100% más allá de la tolerancia", async () => {
        const existing = {
            id: 5,
            productId: 1,
            rawMaterialId: 9,
            percentage: 50,
            update: jest.fn().mockResolvedValue({ id: 5 }),
        }
        ;(ProductRawMaterial.findOne as unknown as jest.Mock).mockResolvedValue(existing)
        mockProductFindOne.mockResolvedValue({ isCustomizable: false })
        mockFindAll.mockResolvedValue([
            { id: 5, percentage: 50 }, // la propia fila, se excluye
            { id: 6, percentage: 60 } // otra fila hermana activa
        ])

        await expect(
            productRawMaterialService.updateProductRawMaterial(5, { percentage: 45 } as never) // 60 + 45 = 105
        ).rejects.toMatchObject({ key: "errors.product_raw_material_percentage_ceiling_exceeded" })
        expect(existing.update).not.toHaveBeenCalled()
    })
})
