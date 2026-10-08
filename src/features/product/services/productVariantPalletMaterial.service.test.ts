jest.mock("../models/ProductVariant.model", () => ({ __esModule: true, default: { findOne: jest.fn(async () => ({ boxesPerPallet: 198 })) } }))
import ProductVariant from "../models/ProductVariant.model"
jest.mock("../../packagingGroup/services/packagingGroup.service", () => ({
    resolveUnitMaterialGroup: jest.fn(async (id, name) => ({ optionGroupId: id ?? null, optionGroup: id != null ? `Group ${id}` : name }))
}))
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
    quantityBasis: "per_pallet" as const,
    optionGroupId: null,
    optionGroup: null as string | null,
    isDefault: false,
}

// Filas "hermanas" agrupadas que devuelve findAll (el servicio ya pide optionGroup != null a la BD
// y filtra por grupo en memoria, así que acá solo se simulan filas agrupadas).
function groupedRow(id: number, optionGroup: string, isDefault: boolean) {
    return { id, productVariantId: 10, optionGroup, isDefault, quantityBasis: "per_pallet", quantityValue: 2 }
}

function existingRow(id: number, optionGroup: string | null, isDefault: boolean, rowUpdate: jest.Mock) {
    return { id, productVariantId: 10, optionGroup, isDefault, quantityBasis: "per_pallet", quantityValue: 2, update: rowUpdate }
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


describe("explicit pallet alternative consumption rules", () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockFindAll.mockResolvedValue([])
        mockCreate.mockImplementation(async input => input)
    })
    it.each([[4, "per_box", 1], [5, "per_pallet", 4]] as const)("supports group %s without interpreting its label", async (optionGroupId, quantityBasis, quantityValue) => {
        mockFindAll.mockResolvedValue([{ id: 1, productVariantId: 10, optionGroupId, optionGroup: "Renamed", quantityBasis, quantityValue, isDefault: true }])
        await productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...BASE_INPUT, optionGroupId, quantityBasis, quantityValue })
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroupId, quantityBasis, quantityValue, isDefault: false }))
    })
    it.each([["per_pallet", 1], ["per_box", 2]] as const)("rejects changing a box alternative to %s=%s before demoting defaults", async (quantityBasis, quantityValue) => {
        mockFindAll.mockResolvedValue([{ id: 1, productVariantId: 10, optionGroupId: 4, optionGroup: "Anything", quantityBasis: "per_box", quantityValue: "1.00", isDefault: true }])
        await expect(productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...BASE_INPUT, optionGroupId: 4, quantityBasis, quantityValue, isDefault: true })).rejects.toMatchObject({ statusCode: 422, key: "errors.pallet_material_group_quantity_mismatch" })
        expect(mockCreate).not.toHaveBeenCalled()
        expect(mockUpdate).not.toHaveBeenCalled()
    })
    it("rejects editing the quantity of one grouped association", async () => {
        const update = jest.fn()
        mockFindOne.mockResolvedValue({ id: 2, productVariantId: 10, optionGroupId: 4, optionGroup: "Anything", isDefault: false, update })
        mockFindAll.mockResolvedValue([{ id: 1, optionGroupId: 4, optionGroup: "Anything", quantityBasis: "per_box", quantityValue: 1, isDefault: true }])
        await expect(productVariantPalletMaterialService.updateProductVariantPalletMaterial(2, { ...BASE_INPUT, optionGroupId: 4, quantityBasis: "per_box", quantityValue: 2 })).rejects.toMatchObject({ statusCode: 422 })
        expect(update).not.toHaveBeenCalled()
    })
})


describe("simplified manual pallet consumption", () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockFindAll.mockResolvedValue([])
        mockCreate.mockImplementation(async values => values)
        mockAssertRole.mockResolvedValue({ code: "MP-X", packagingRole: "pallet", defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4 })
        ;(ProductVariant.findOne as jest.Mock).mockResolvedValue({ boxesPerPallet: 198 })
    })
    const simplified = { productVariantId: 10, packagingId: 5, optionGroupId: null, optionGroup: null, isDefault: false }
    it.each([["per_box", 1], ["per_pallet", 4], ["per_pallet", 1], ["per_pallet", 93.3]] as const)("copies catalog rule %s/%s to new associations", async (basis, quantity) => {
        mockAssertRole.mockResolvedValue({ code: "MP-X", defaultQuantityBasis: basis, defaultQuantityValue: String(quantity) })
        await productVariantPalletMaterialService.createProductVariantPalletMaterial(simplified)
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ quantityBasis: basis, quantityValue: quantity, optionGroupId: null, isDefault: false }))
    })
    it("blocks creation when the catalog default is missing", async () => {
        mockAssertRole.mockResolvedValue({ code: "MP-X", defaultQuantityBasis: null, defaultQuantityValue: null })
        await expect(productVariantPalletMaterialService.createProductVariantPalletMaterial(simplified)).rejects.toMatchObject({ key: "errors.packaging_consumption_missing" })
        expect(mockCreate).not.toHaveBeenCalled()
    })
    it("preserves an existing override when updating without an explicit rule", async () => {
        const update = jest.fn()
        mockFindOne.mockResolvedValue({ ...simplified, id: 100, quantityBasis: "per_pallet", quantityValue: "7.00", update })
        await productVariantPalletMaterialService.updateProductVariantPalletMaterial(100, simplified)
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ quantityBasis: "per_pallet", quantityValue: 7 }))
        mockAssertRole.mockResolvedValue({ code: "MP-X", defaultQuantityBasis: "per_pallet", defaultQuantityValue: 5 })
        await productVariantPalletMaterialService.updateProductVariantPalletMaterial(100, simplified)
        expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ quantityValue: 7 }))
    })
    it("uses the new material default when changing material identity", async () => {
        const update = jest.fn()
        mockFindOne.mockResolvedValue({ ...simplified, id: 100, quantityBasis: "per_pallet", quantityValue: 7, update })
        await productVariantPalletMaterialService.updateProductVariantPalletMaterial(100, { ...simplified, packagingId: 6 })
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ packagingId: 6, quantityValue: 4 }))
    })
    it("permits an explicit override without changing the global catalog", async () => {
        const material = { code: "MP-X", defaultQuantityBasis: "per_pallet", defaultQuantityValue: 4 }
        mockAssertRole.mockResolvedValue(material)
        await productVariantPalletMaterialService.createProductVariantPalletMaterial({ ...simplified, quantityBasis: "per_pallet", quantityValue: 9 })
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ quantityValue: 9 }))
        expect(material.defaultQuantityValue).toBe(4)
    })
    it.each([null, 0, -1, Infinity])("rejects per_box with invalid boxesPerPallet %s", async boxesPerPallet => {
        mockAssertRole.mockResolvedValue({ code: "MP-X", defaultQuantityBasis: "per_box", defaultQuantityValue: 1 })
        ;(ProductVariant.findOne as jest.Mock).mockResolvedValue({ boxesPerPallet })
        await expect(productVariantPalletMaterialService.createProductVariantPalletMaterial(simplified)).rejects.toMatchObject({ key: "errors.pallet_boxes_required" })
        expect(mockCreate).not.toHaveBeenCalled()
    })
})
