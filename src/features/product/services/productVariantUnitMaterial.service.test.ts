import "reflect-metadata"
import { Op } from "sequelize"

jest.mock("../models/ProductVariantUnitMaterial.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() }
}))
jest.mock("../../packaging/services/packaging.service", () => ({
    packagingService: { assertPackagingHasRole: jest.fn() }
}))

import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import { packagingService } from "../../packaging/services/packaging.service"
import { productVariantUnitMaterialService } from "./productVariantUnitMaterial.service"

const mockFindOne = ProductVariantUnitMaterial.findOne as unknown as jest.Mock
const mockFindAll = ProductVariantUnitMaterial.findAll as unknown as jest.Mock
const mockCreate = ProductVariantUnitMaterial.create as unknown as jest.Mock
const mockUpdate = ProductVariantUnitMaterial.update as unknown as jest.Mock
const mockCount = ProductVariantUnitMaterial.count as unknown as jest.Mock
const mockAssertRole = packagingService.assertPackagingHasRole as jest.Mock

const BASE_INPUT = {
    productVariantId: 10,
    packagingId: 5,
    quantityPerUnit: 1,
    isSwappable: false,
    isDefault: false,
}

describe("productVariantUnitMaterialService -- default + opcional (2026-09-21)", () => {
    beforeEach(() => {
        mockFindOne.mockReset()
        mockFindAll.mockReset()
        mockCreate.mockReset()
        mockUpdate.mockReset()
        mockCount.mockReset()
        mockAssertRole.mockReset().mockResolvedValue(undefined)
        mockFindAll.mockResolvedValue([])
        mockCreate.mockImplementation((input) => Promise.resolve({ id: 1, ...input }))
    })

    describe("crear", () => {
        it("una fila isSwappable=false no fuerza isDefault, mismo comportamiento de siempre", async () => {
            await productVariantUnitMaterialService.createProductVariantUnitMaterial(BASE_INPUT)

            expect(mockFindAll).not.toHaveBeenCalled()
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
        })

        it("la primera fila swappable de la variante se fuerza a isDefault=true sin importar lo pedido", async () => {
            mockFindAll.mockResolvedValue([])

            await productVariantUnitMaterialService.createProductVariantUnitMaterial({
                ...BASE_INPUT,
                isSwappable: true,
                isDefault: false,
            })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))
        })

        it("una fila swappable adicional NO se vuelve default si no se pide y ya hay otra swappable", async () => {
            mockFindAll.mockResolvedValue([{ id: 1, isDefault: true }])

            await productVariantUnitMaterialService.createProductVariantUnitMaterial({
                ...BASE_INPUT,
                isSwappable: true,
                isDefault: false,
            })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
            expect(mockUpdate).not.toHaveBeenCalled()
        })

        it("pedir isDefault=true en una fila que no es la primera auto-demueve al default anterior", async () => {
            mockFindAll.mockResolvedValue([{ id: 1, isDefault: true }, { id: 2, isDefault: false }])

            await productVariantUnitMaterialService.createProductVariantUnitMaterial({
                ...BASE_INPUT,
                isSwappable: true,
                isDefault: true,
            })

            expect(mockUpdate).toHaveBeenCalledWith(
                { isDefault: false },
                { where: { id: { [Op.in]: [1] } } }
            )
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))
        })

        it("valida el rol de empaque (unit) antes de crear", async () => {
            await productVariantUnitMaterialService.createProductVariantUnitMaterial(BASE_INPUT)
            expect(mockAssertRole).toHaveBeenCalledWith(5, "unit")
        })
    })

    describe("actualizar", () => {
        it("rechaza quitar isDefault al default vigente si quedan otras alternativas swappable (dejaría el nivel con CERO defaults)", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(1)

            await expect(
                productVariantUnitMaterialService.updateProductVariantUnitMaterial(1, { ...BASE_INPUT, isSwappable: true, isDefault: false })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required" })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("rechaza desmarcar isSwappable en el default vigente si quedan otras alternativas swappable", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(2)

            await expect(
                productVariantUnitMaterialService.updateProductVariantUnitMaterial(1, { ...BASE_INPUT, isSwappable: false, isDefault: false })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required" })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("permite editar otros campos del default vigente si sigue siendo swappable y default (sin consultar hermanas)", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })

            await productVariantUnitMaterialService.updateProductVariantUnitMaterial(1, { ...BASE_INPUT, quantityPerUnit: 3, isSwappable: true, isDefault: true })

            expect(mockCount).not.toHaveBeenCalled()
            expect(rowUpdate).toHaveBeenCalledWith(expect.objectContaining({ quantityPerUnit: 3, isDefault: true }))
        })

        it("permite quitar isDefault a una fila que NO es el default vigente", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 2, productVariantId: 10, isSwappable: true, isDefault: false, update: rowUpdate })
            mockFindAll.mockResolvedValue([{ id: 1, isDefault: true }])

            await productVariantUnitMaterialService.updateProductVariantUnitMaterial(2, { ...BASE_INPUT, isSwappable: true, isDefault: false })

            expect(rowUpdate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
        })

        it("desmarcar isSwappable en la ÚNICA fila swappable (el default) sí se permite -- el nivel simplemente deja de tener menú", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(0)

            await productVariantUnitMaterialService.updateProductVariantUnitMaterial(1, {
                ...BASE_INPUT,
                isSwappable: false,
                isDefault: false,
            })

            expect(rowUpdate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
        })
    })

    describe("eliminar (decisión 2026-09-21: bloquear, no auto-promover)", () => {
        it("rechaza eliminar el default vigente si quedan otras alternativas swappable activas", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(1)

            await expect(productVariantUnitMaterialService.deleteProductVariantUnitMaterial(1)).rejects.toMatchObject({
                statusCode: 409,
                key: "errors.unit_material_default_deletion_blocked",
            })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("permite eliminar el default si es la única fila swappable (no quedan huérfanas sin default)", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(0)

            await productVariantUnitMaterialService.deleteProductVariantUnitMaterial(1)

            expect(rowUpdate).toHaveBeenCalledWith({ isActive: false })
        })

        it("permite eliminar una fila no-default sin restricción", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 2, productVariantId: 10, isSwappable: true, isDefault: false, update: rowUpdate })

            await productVariantUnitMaterialService.deleteProductVariantUnitMaterial(2)

            expect(mockCount).not.toHaveBeenCalled()
            expect(rowUpdate).toHaveBeenCalledWith({ isActive: false })
        })
    })
})
