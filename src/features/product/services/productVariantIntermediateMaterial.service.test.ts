import "reflect-metadata"
import { Op } from "sequelize"

jest.mock("../models/ProductVariantIntermediateMaterial.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() }
}))
jest.mock("../../packaging/services/packaging.service", () => ({
    packagingService: { assertPackagingHasRole: jest.fn() }
}))

import ProductVariantIntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import { packagingService } from "../../packaging/services/packaging.service"
import { productVariantIntermediateMaterialService } from "./productVariantIntermediateMaterial.service"

const mockFindOne = ProductVariantIntermediateMaterial.findOne as unknown as jest.Mock
const mockFindAll = ProductVariantIntermediateMaterial.findAll as unknown as jest.Mock
const mockCreate = ProductVariantIntermediateMaterial.create as unknown as jest.Mock
const mockUpdate = ProductVariantIntermediateMaterial.update as unknown as jest.Mock
const mockCount = ProductVariantIntermediateMaterial.count as unknown as jest.Mock
const mockAssertRole = packagingService.assertPackagingHasRole as jest.Mock

const BASE_INPUT = {
    productVariantId: 10,
    packagingId: 7,
    isSwappable: false,
    isDefault: false,
}

// Nuevo join table (2026-09-21) que reemplaza ProductVariant.intermediatePackagingId (FK único) --
// mismas reglas de default + opcional que Unit/Pallet material, ver esos archivos de prueba.
describe("productVariantIntermediateMaterialService -- default + opcional (2026-09-21)", () => {
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
        it("una fila isSwappable=false no fuerza isDefault -- comportamiento equivalente al viejo FK único", async () => {
            await productVariantIntermediateMaterialService.createProductVariantIntermediateMaterial(BASE_INPUT)

            expect(mockFindAll).not.toHaveBeenCalled()
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
        })

        it("la primera fila swappable de la variante se fuerza a isDefault=true", async () => {
            mockFindAll.mockResolvedValue([])

            await productVariantIntermediateMaterialService.createProductVariantIntermediateMaterial({
                ...BASE_INPUT,
                isSwappable: true,
                isDefault: false,
            })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))
        })

        it("pedir isDefault=true en una fila que no es la primera auto-demueve al default anterior", async () => {
            mockFindAll.mockResolvedValue([{ id: 1, isDefault: true }])

            await productVariantIntermediateMaterialService.createProductVariantIntermediateMaterial({
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

        it("valida el rol de empaque (intermediate) antes de crear", async () => {
            await productVariantIntermediateMaterialService.createProductVariantIntermediateMaterial(BASE_INPUT)
            expect(mockAssertRole).toHaveBeenCalledWith(7, "intermediate")
        })
    })

    describe("actualizar -- el nivel nunca puede quedar con alternativas swappable y CERO defaults", () => {
        it("rechaza quitar isDefault al default vigente si quedan otras alternativas swappable", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(1)

            await expect(
                productVariantIntermediateMaterialService.updateProductVariantIntermediateMaterial(1, { ...BASE_INPUT, isSwappable: true, isDefault: false })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required" })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("rechaza desmarcar isSwappable en el default vigente si quedan otras alternativas swappable", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(1)

            await expect(
                productVariantIntermediateMaterialService.updateProductVariantIntermediateMaterial(1, { ...BASE_INPUT, isSwappable: false, isDefault: false })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required" })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("permite editar el default vigente mientras siga siendo swappable y default", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })

            await productVariantIntermediateMaterialService.updateProductVariantIntermediateMaterial(1, { ...BASE_INPUT, isSwappable: true, isDefault: true })

            expect(mockCount).not.toHaveBeenCalled()
            expect(rowUpdate).toHaveBeenCalledTimes(1)
        })
    })

    // Silencio-fallo cerrado (2026-09-21): el motor resolvía en silencio SOLO la primera de dos filas
    // fijas de empaque intermedio (subcosteo) -- ahora ni siquiera se puede guardar la segunda.
    describe("a lo sumo UNA fila fija (isSwappable=false) de empaque intermedio por variante", () => {
        it("rechaza CREAR una segunda fila fija si la variante ya tiene una", async () => {
            mockCount.mockResolvedValue(1)

            await expect(
                productVariantIntermediateMaterialService.createProductVariantIntermediateMaterial(BASE_INPUT)
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.multiple_fixed_intermediate_materials" })
            expect(mockCreate).not.toHaveBeenCalled()
            expect(mockCount).toHaveBeenCalledWith({ where: { productVariantId: 10, isSwappable: false, isActive: true } })
        })

        it("permite crear la PRIMERA fila fija", async () => {
            mockCount.mockResolvedValue(0)

            await productVariantIntermediateMaterialService.createProductVariantIntermediateMaterial(BASE_INPUT)

            expect(mockCreate).toHaveBeenCalledTimes(1)
        })

        it("permite crear varias filas swappable (es el menú de alternativas) sin consultar filas fijas", async () => {
            mockFindAll.mockResolvedValue([{ id: 1, isDefault: true }])

            await productVariantIntermediateMaterialService.createProductVariantIntermediateMaterial({ ...BASE_INPUT, isSwappable: true, isDefault: false })

            expect(mockCount).not.toHaveBeenCalled()
            expect(mockCreate).toHaveBeenCalledTimes(1)
        })

        it("rechaza ACTUALIZAR una fila swappable a fija si la variante ya tiene otra fija", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 2, productVariantId: 10, isSwappable: true, isDefault: false, update: rowUpdate })
            mockCount.mockResolvedValue(1)

            await expect(
                productVariantIntermediateMaterialService.updateProductVariantIntermediateMaterial(2, { ...BASE_INPUT, isSwappable: false, isDefault: false })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.multiple_fixed_intermediate_materials" })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("editar la única fila fija existente no choca consigo misma (se excluye su propio id)", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: false, isDefault: false, update: rowUpdate })
            mockCount.mockResolvedValue(0)

            await productVariantIntermediateMaterialService.updateProductVariantIntermediateMaterial(1, BASE_INPUT)

            expect(mockCount).toHaveBeenCalledWith({
                where: { productVariantId: 10, isSwappable: false, isActive: true, id: { [Op.ne]: 1 } },
            })
            expect(rowUpdate).toHaveBeenCalledTimes(1)
        })
    })

    describe("eliminar (decisión 2026-09-21: bloquear, no auto-promover)", () => {
        it("rechaza eliminar el default vigente si quedan otras alternativas swappable activas", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue({ id: 1, productVariantId: 10, isSwappable: true, isDefault: true, update: rowUpdate })
            mockCount.mockResolvedValue(1)

            await expect(productVariantIntermediateMaterialService.deleteProductVariantIntermediateMaterial(1)).rejects.toMatchObject({
                statusCode: 409,
                key: "errors.intermediate_material_default_deletion_blocked",
            })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("permite eliminar una fila no-default sin restricción", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue({ id: 2, productVariantId: 10, isSwappable: true, isDefault: false, update: rowUpdate })

            await productVariantIntermediateMaterialService.deleteProductVariantIntermediateMaterial(2)

            expect(mockCount).not.toHaveBeenCalled()
            expect(rowUpdate).toHaveBeenCalledWith({ isActive: false })
        })
    })
})
