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
        mockFindAll.mockResolvedValue([]) // sin filas hermanas por defecto (ver assertRecipePercentageCeiling)
    })

    describe("porcentaje obligatorio en cada fila de la receta", () => {
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

        it("acepta percentage positivo", async () => {
            mockCreate.mockResolvedValue({ id: 1 })

            await productRawMaterialService.createProductRawMaterial({ productId: 1, rawMaterialId: 9, percentage: 50 } as never)

            expect(mockCreate).toHaveBeenCalledTimes(1)
            expect(mockRawMaterialFindOne).not.toHaveBeenCalled()
        })
    })

    describe("techo blando de 100% (assertRecipePercentageCeiling)", () => {
        it("permite guardar una receta incompleta (< 100%) mientras se arma fila por fila", async () => {
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

describe("productRawMaterialService.createProductRawMaterial -- materias primas sin clasificación orgánica", () => {
    beforeEach(() => {
        mockProductFindOne.mockResolvedValue({ isOrganic: true })
        mockFindAll.mockResolvedValue([])
    })

    it("un producto orgánico acepta cualquier materia prima: el catálogo ya no las clasifica", async () => {
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

    it("rechaza vaciar percentage al editar", async () => {
        const existing = {
            id: 5,
            productId: 1,
            rawMaterialId: 9,
            percentage: 50,
            update: jest.fn().mockResolvedValue({ id: 5 }),
        }
        ;(ProductRawMaterial.findOne as unknown as jest.Mock).mockResolvedValue(existing)

        await expect(
            productRawMaterialService.updateProductRawMaterial(5, { percentage: null } as never)
        ).rejects.toMatchObject({ key: "errors.product_raw_material_percentage_required" })
        expect(existing.update).not.toHaveBeenCalled()
    })

    it("calcula el techo de 100% contra el producto EFECTIVO (el nuevo productId del input, no el viejo)", async () => {
        const existing = {
            id: 5,
            productId: 1,
            rawMaterialId: 9,
            percentage: 50,
            update: jest.fn().mockResolvedValue({ id: 5 }),
        }
        ;(ProductRawMaterial.findOne as unknown as jest.Mock).mockResolvedValue(existing)

        await productRawMaterialService.updateProductRawMaterial(5, { productId: 2, percentage: 60 } as never)

        expect(mockFindAll).toHaveBeenCalledWith({ where: { productId: 2, isActive: true } })
        expect(existing.update).toHaveBeenCalledTimes(1)
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
