import "reflect-metadata"
import { Op } from "sequelize"

jest.mock("../models/ProductVariantPalletMaterial.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() }
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
const mockAssertRole = packagingService.assertPackagingHasRole as jest.Mock

const BASE_INPUT = {
    productVariantId: 10,
    packagingId: 5,
    quantityValue: 2,
    optionGroup: null as string | null,
    isDefault: false,
}

// Filas "hermanas" agrupadas que devuelve findAll (el servicio ya pide optionGroup != null a la BD
// y filtra por grupo en memoria, así que acá solo se simulan filas agrupadas).
function groupedRow(id: number, optionGroup: string, isDefault: boolean) {
    return { id, productVariantId: 10, optionGroup, isDefault }
}

function existingRow(id: number, optionGroup: string | null, isDefault: boolean, rowUpdate: jest.Mock) {
    return { id, productVariantId: 10, optionGroup, isDefault, update: rowUpdate }
}

describe("productVariantPalletMaterialService -- grupos de opciones (2026-09-24)", () => {
    beforeEach(() => {
        mockFindOne.mockReset()
        mockFindAll.mockReset()
        mockCreate.mockReset()
        mockUpdate.mockReset()
        mockAssertRole.mockReset().mockResolvedValue(undefined)
        mockFindAll.mockResolvedValue([])
        mockCreate.mockImplementation((input) => Promise.resolve({ id: 99, ...input }))
    })

    describe("crear", () => {
        it("una fila fija (optionGroup=null) nunca es default y no consulta hermanas", async () => {
            await productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...BASE_INPUT, isDefault: true })

            expect(mockFindAll).not.toHaveBeenCalled()
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: null, isDefault: false }))
        })

        it("la primera fila de un grupo se fuerza a isDefault=true sin importar lo pedido", async () => {
            await productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...BASE_INPUT, optionGroup: "Caja", isDefault: false })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: "Caja", isDefault: true }))
        })

        it("la primera fila de un grupo NUEVO es su default aunque otro grupo del SKU ya tenga default (grupos independientes)", async () => {
            mockFindAll.mockResolvedValue([groupedRow(1, "Caja", true), groupedRow(2, "Caja", false)])

            await productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...BASE_INPUT, optionGroup: "Esquinero", isDefault: false })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: "Esquinero", isDefault: true }))
            expect(mockUpdate).not.toHaveBeenCalled()
        })

        it("una fila adicional del mismo grupo NO se vuelve default si no se pide", async () => {
            mockFindAll.mockResolvedValue([groupedRow(1, "Caja", true)])

            await productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...BASE_INPUT, optionGroup: "Caja", isDefault: false })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
            expect(mockUpdate).not.toHaveBeenCalled()
        })

        it("pedir isDefault=true desmarca SOLO al default de su propio grupo", async () => {
            mockFindAll.mockResolvedValue([groupedRow(1, "Caja", true), groupedRow(2, "Esquinero", true), groupedRow(3, "Caja", false)])

            await productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...BASE_INPUT, optionGroup: "Caja", isDefault: true })

            expect(mockUpdate).toHaveBeenCalledTimes(1)
            expect(mockUpdate).toHaveBeenCalledWith({ isDefault: false }, { where: { id: { [Op.in]: [1] } } })
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))
        })

        it("reutiliza la grafía de un grupo existente del SKU (\"  caja \" se une a \"Caja\")", async () => {
            mockFindAll.mockResolvedValue([groupedRow(1, "Caja", true)])

            await productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...BASE_INPUT, optionGroup: "  caja ", isDefault: false })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: "Caja", isDefault: false }))
        })

        it("colapsa espacios internos de un nombre de grupo nuevo", async () => {
            await productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...BASE_INPUT, optionGroup: "Caja   de   envío", isDefault: false })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: "Caja de envío" }))
        })

        it("valida el rol de empaque (pallet) antes de crear", async () => {
            await productVariantPalletMaterialService.createProductVariantPalletMaterial(BASE_INPUT)
            expect(mockAssertRole).toHaveBeenCalledWith(5, "pallet")
        })
    })

    describe("actualizar -- un grupo nunca puede quedar con alternativas y CERO defaults", () => {
        it("rechaza quitar isDefault al default de un grupo si el grupo tiene otras filas", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue(existingRow(1, "Caja", true, rowUpdate))
            mockFindAll.mockResolvedValue([groupedRow(1, "Caja", true), groupedRow(2, "Caja", false)])

            await expect(
                productVariantPalletMaterialService.updateProductVariantPalletMaterial(1, { ...BASE_INPUT, optionGroup: "Caja", isDefault: false })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required", params: { group: "Caja" } })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("rechaza volver fija (optionGroup=null) la fila default si su grupo tiene otras filas", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue(existingRow(1, "Caja", true, rowUpdate))
            mockFindAll.mockResolvedValue([groupedRow(2, "Caja", false)])

            await expect(
                productVariantPalletMaterialService.updateProductVariantPalletMaterial(1, { ...BASE_INPUT, optionGroup: null, isDefault: false })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required" })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("rechaza MOVER el default a otro grupo si su grupo viejo queda con filas y sin default", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue(existingRow(1, "Caja", true, rowUpdate))
            mockFindAll.mockResolvedValue([groupedRow(2, "Caja", false), groupedRow(3, "Esquinero", true)])

            await expect(
                productVariantPalletMaterialService.updateProductVariantPalletMaterial(1, { ...BASE_INPUT, optionGroup: "Esquinero", isDefault: true })
            ).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required", params: { group: "Caja" } })
            expect(rowUpdate).not.toHaveBeenCalled()
            expect(mockUpdate).not.toHaveBeenCalled()
        })

        it("permite mover la ÚLTIMA fila de un grupo a otro grupo como default, desmarcando el default del destino", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue(existingRow(1, "Caja", true, rowUpdate))
            mockFindAll.mockResolvedValue([groupedRow(3, "Esquinero", true)])

            await productVariantPalletMaterialService.updateProductVariantPalletMaterial(1, { ...BASE_INPUT, optionGroup: "Esquinero", isDefault: true })

            expect(mockUpdate).toHaveBeenCalledWith({ isDefault: false }, { where: { id: { [Op.in]: [3] } } })
            expect(rowUpdate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: "Esquinero", isDefault: true }))
        })

        it("permite editar otros campos del default mientras siga siendo default del mismo grupo (sin distinguir mayúsculas)", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue(existingRow(1, "Caja", true, rowUpdate))
            mockFindAll.mockResolvedValue([groupedRow(1, "Caja", true), groupedRow(2, "Caja", false)])

            await productVariantPalletMaterialService.updateProductVariantPalletMaterial(1, { ...BASE_INPUT, optionGroup: "CAJA", isDefault: true })

            expect(mockUpdate).not.toHaveBeenCalled()
            expect(rowUpdate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: "Caja", isDefault: true }))
        })

        it("permite quitar isDefault a una fila que NO es el default de su grupo", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue(existingRow(2, "Caja", false, rowUpdate))
            mockFindAll.mockResolvedValue([groupedRow(1, "Caja", true), groupedRow(2, "Caja", false)])

            await productVariantPalletMaterialService.updateProductVariantPalletMaterial(2, { ...BASE_INPUT, optionGroup: "Caja", isDefault: false })

            expect(rowUpdate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
        })

        it("volver fija la ÚNICA fila de un grupo sí se permite -- el grupo simplemente desaparece", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue(existingRow(1, "Caja", true, rowUpdate))
            mockFindAll.mockResolvedValue([groupedRow(1, "Caja", true), groupedRow(3, "Esquinero", true)])

            await productVariantPalletMaterialService.updateProductVariantPalletMaterial(1, { ...BASE_INPUT, optionGroup: null, isDefault: false })

            expect(rowUpdate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: null, isDefault: false }))
        })
    })

    describe("eliminar (decisión 2026-09-21: bloquear, no auto-promover -- ahora por grupo)", () => {
        it("rechaza eliminar el default de un grupo si ese grupo tiene otras filas activas", async () => {
            const rowUpdate = jest.fn()
            mockFindOne.mockResolvedValue(existingRow(1, "Caja", true, rowUpdate))
            mockFindAll.mockResolvedValue([groupedRow(2, "caja", false)])

            await expect(productVariantPalletMaterialService.deleteProductVariantPalletMaterial(1)).rejects.toMatchObject({
                statusCode: 409,
                key: "errors.pallet_material_default_deletion_blocked",
                params: { group: "Caja" },
            })
            expect(rowUpdate).not.toHaveBeenCalled()
        })

        it("permite eliminar el default si es la última fila de SU grupo (otros grupos no cuentan)", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue(existingRow(1, "Caja", true, rowUpdate))
            mockFindAll.mockResolvedValue([groupedRow(3, "Esquinero", true), groupedRow(4, "Esquinero", false)])

            await productVariantPalletMaterialService.deleteProductVariantPalletMaterial(1)

            expect(rowUpdate).toHaveBeenCalledWith({ isActive: false })
        })

        it("permite eliminar una fila no-default (o fija) sin consultar hermanas", async () => {
            const rowUpdate = jest.fn().mockResolvedValue(undefined)
            mockFindOne.mockResolvedValue(existingRow(2, "Caja", false, rowUpdate))

            await productVariantPalletMaterialService.deleteProductVariantPalletMaterial(2)

            expect(mockFindAll).not.toHaveBeenCalled()
            expect(rowUpdate).toHaveBeenCalledWith({ isActive: false })
        })
    })
})
