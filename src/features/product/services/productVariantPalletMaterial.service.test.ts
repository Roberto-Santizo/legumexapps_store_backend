import "reflect-metadata"
import { Op } from "sequelize"

jest.mock("../models/ProductVariantPalletMaterial.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() }
}))
jest.mock("../../packaging/services/packaging.service", () => ({
    packagingService: { assertPackagingHasRole: jest.fn() }
}))

import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { packagingService } from "../../packaging/services/packaging.service"
import { productVariantPalletMaterialService } from "./productVariantPalletMaterial.service"

const mockFindOne = ProductVariantPalletMaterial.findOne as unknown as jest.Mock
const mockFindAll = ProductVariantPalletMaterial.findAll as unknown as jest.Mock
const mockCreate = ProductVariantPalletMaterial.create as unknown as jest.Mock
const mockUpdate = ProductVariantPalletMaterial.update as unknown as jest.Mock
const mockCount = ProductVariantPalletMaterial.count as unknown as jest.Mock
const mockAssertRole = packagingService.assertPackagingHasRole as jest.Mock

const BASE_INPUT = {
    productVariantId: 10,
    packagingId: 6,
    quantityValue: 1,
    isSwappable: false,
    isDefault: false,
}

describe("productVariantPalletMaterialService -- default + opcional (2026-09-21)", () => {
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
            await productVariantPalletMaterialService.createProductVariantPalletMaterial(BASE_INPUT)

            expect(mockFindAll).not.toHaveBeenCalled()
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
        })

        it("la primera fila swappable de la variante se fuerza a isDefault=true", async () => {
            mockFindAll.mockResolvedValue([])

            await productVariantPalletMaterialService.createProductVariantPalletMaterial({
                ...BASE_INPUT,
                isSwappable: true,
                isDefault: false,
            })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))
        })

        it("pedir isDefault=true en una fila que no es la primera auto-demueve al default anterior", async () => {
            mockFindAll.mockResolvedValue([{ id: 1, isDefault: true }])

            await productVariantPalletMaterialService.createProductVariantPalletMaterial({
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

        it("valida el rol de empaque (pallet) antes de crear", async () => {
            await productVariantPalletMaterialService.createProductVariantPalletMaterial(BASE_INPUT)
            expect(mockAssertRole).toHaveBeenCalledWith(6, "pallet")
        })
    })

    describe("actualizar -- el nivel nunca puede quedar con alternativas swappable y CERO defaults", () => {
        it("rechaza quitar isDefault al default vigente si quedan otras alternativas swappable", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(1)

            await expect(
                productVariantPalletMaterialService.updateProductVariantPalletMaterial(1, { ...BASE_INPUT, isSwappable: true, isDefault: false })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required" })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("rechaza desmarcar isSwappable en el default vigente si quedan otras alternativas swappable", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(1)

            await expect(
                productVariantPalletMaterialService.updateProductVariantPalletMaterial(1, { ...BASE_INPUT, isSwappable: false, isDefault: false })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required" })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("permite editar otros campos del default vigente mientras siga siendo swappable y default", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })

            await productVariantPalletMaterialService.updateProductVariantPalletMaterial(1, { ...BASE_INPUT, quantityValue: 4, isSwappable: true, isDefault: true })

            expect(mockCount).not.toHaveBeenCalled()
            expect(rowUpdate).toHaveBeenCalledWith(expect.objectContaining({ quantityValue: 4, isDefault: true }))
        })
    })

    describe("eliminar (decisión 2026-09-21: bloquear, no auto-promover)", () => {
        it("rechaza eliminar el default vigente si quedan otras alternativas swappable activas", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(1)

            await expect(productVariantPalletMaterialService.deleteProductVariantPalletMaterial(1)).rejects.toMatchObject({
                statusCode: 409,
                key: "errors.pallet_material_default_deletion_blocked",
            })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("permite eliminar una fila no-default sin restricción", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 2, productVariantId: 10, isSwappable: true, isDefault: false, update: rowUpdate })

            await productVariantPalletMaterialService.deleteProductVariantPalletMaterial(2)

            expect(mockCount).not.toHaveBeenCalled()
            expect(rowUpdate).toHaveBeenCalledWith({ isActive: false })
        })
    })
})
