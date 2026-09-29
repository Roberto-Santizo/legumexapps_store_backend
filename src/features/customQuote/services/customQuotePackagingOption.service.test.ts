import "reflect-metadata"
import { Op } from "sequelize"

jest.mock("../models/CustomQuotePackagingOption.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() }
}))
jest.mock("../../packaging/models/Packaging.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))

import CustomQuotePackagingOption from "../models/CustomQuotePackagingOption.model"
import Packaging from "../../packaging/models/Packaging.model"
import { customQuotePackagingOptionService } from "./customQuotePackagingOption.service"

const mockFindOne = CustomQuotePackagingOption.findOne as unknown as jest.Mock
const mockFindAll = CustomQuotePackagingOption.findAll as unknown as jest.Mock
const mockCreate = CustomQuotePackagingOption.create as unknown as jest.Mock
const mockUpdate = CustomQuotePackagingOption.update as unknown as jest.Mock
const mockPackagingFindOne = Packaging.findOne as unknown as jest.Mock

type Level = "unit" | "intermediate" | "pallet"

function packaging(id: number, packagingRole: Level) {
    return { id, packagingRole, code: `P-${id}`, displayName: `Material ${id}`, unitCost: "0.2500" }
}

// Fila existente de la lista de permitidos, con su empaque incluido (el nivel sale de ahí).
function optionRow(
    id: number,
    level: Level,
    optionGroup: string | null,
    isDefault: boolean,
    overrides: Record<string, unknown> = {}
) {
    const row: Record<string, unknown> = {
        id,
        packagingId: 100 + id,
        quantity: level === "intermediate" ? null : "2.00",
        quantityBasis: level === "unit" ? "per_unit" : level === "pallet" ? "per_pallet" : null,
        optionGroup,
        isDefault,
        isActive: true,
        packaging: packaging(100 + id, level),
        ...overrides,
    }
    row.update = jest.fn(async (values: Record<string, unknown>) => ({ ...row, ...values }))
    return row
}

const UNIT_INPUT = { packagingId: 5, quantity: 1, quantityBasis: null, optionGroup: null, isDefault: false }

describe("customQuotePackagingOptionService", () => {
    beforeEach(() => {
        mockFindOne.mockReset().mockResolvedValue(null)
        mockFindAll.mockReset().mockResolvedValue([])
        mockCreate.mockReset().mockImplementation(async (input) => ({ id: 99, ...input }))
        mockUpdate.mockReset()
        mockPackagingFindOne.mockReset().mockResolvedValue(packaging(5, "unit"))
    })

    describe("crear -- cantidad según el nivel del empaque", () => {
        it("empaque individual: la cantidad es obligatoria y la base se asume por unidad", async () => {
            await customQuotePackagingOptionService.createPackagingOption(UNIT_INPUT)

            expect(mockCreate).toHaveBeenCalledWith({
                packagingId: 5, quantity: 1, quantityBasis: "per_unit", optionGroup: null, isDefault: false
            })
        })

        it("empaque individual sin cantidad -> 422 y no crea", async () => {
            await expect(customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, quantity: null }))
                .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_packaging_quantity_required" })
            expect(mockCreate).not.toHaveBeenCalled()
        })

        it("empaque individual con base por caja -> 422 (solo aplica a paletización)", async () => {
            await expect(customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, quantityBasis: "per_box" }))
                .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_packaging_invalid_quantity_basis" })
        })

        it("paletización sin base -> 422 (hay que elegir por palet o por caja)", async () => {
            mockPackagingFindOne.mockResolvedValue(packaging(5, "pallet"))

            await expect(customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, quantity: 1 }))
                .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_packaging_quantity_basis_required" })
        })

        it("paletización por caja se guarda tal cual", async () => {
            mockPackagingFindOne.mockResolvedValue(packaging(5, "pallet"))

            await customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, quantity: 1, quantityBasis: "per_box" })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1, quantityBasis: "per_box" }))
        })

        it("empaque intermedio con cantidad -> 422; sin cantidad se guarda en null", async () => {
            mockPackagingFindOne.mockResolvedValue(packaging(5, "intermediate"))

            await expect(customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, quantity: 3 }))
                .rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_intermediate_packaging_has_no_quantity" })

            await customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, quantity: null })
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ quantity: null, quantityBasis: null }))
        })

        it("empaque inexistente o inactivo -> 404", async () => {
            mockPackagingFindOne.mockResolvedValue(null)

            await expect(customQuotePackagingOptionService.createPackagingOption(UNIT_INPUT))
                .rejects.toMatchObject({ statusCode: 404 })
            expect(mockPackagingFindOne).toHaveBeenCalledWith({ where: { id: 5, isActive: true } })
        })

        it("el empaque ya está en la lista (activo o no) -> 409, no duplica", async () => {
            mockFindOne.mockResolvedValue(optionRow(1, "unit", null, false, { isActive: false }))

            await expect(customQuotePackagingOptionService.createPackagingOption(UNIT_INPUT))
                .rejects.toMatchObject({ statusCode: 409, key: "errors.custom_quote_option_already_exists" })
            expect(mockFindOne).toHaveBeenCalledWith({ where: { packagingId: 5 } })
            expect(mockCreate).not.toHaveBeenCalled()
        })
    })

    describe("crear -- grupos de opciones por nivel", () => {
        it("una fila fija nunca es default y no consulta hermanas", async () => {
            await customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, isDefault: true })

            expect(mockFindAll).not.toHaveBeenCalled()
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: null, isDefault: false }))
        })

        it("la primera fila de un grupo se fuerza a default", async () => {
            await customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, optionGroup: "Bolsa", isDefault: false })

            expect(mockFindAll).toHaveBeenCalledWith(expect.objectContaining({
                where: { optionGroup: { [Op.ne]: null }, isActive: true }
            }))
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: "Bolsa", isDefault: true }))
        })

        it("un grupo con el mismo nombre en OTRO nivel no cuenta: sigue siendo la primera fila", async () => {
            mockFindAll.mockResolvedValue([optionRow(1, "pallet", "Bolsa", true)])

            await customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, optionGroup: "Bolsa", isDefault: false })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))
            expect(mockUpdate).not.toHaveBeenCalled()
        })

        it("pedir default con uno ya existente en el grupo lo degrada solo a él", async () => {
            mockFindAll.mockResolvedValue([
                optionRow(1, "unit", "Bolsa", true),
                optionRow(2, "unit", "Etiqueta", true),
                optionRow(3, "pallet", "Bolsa", true),
            ])

            await customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, optionGroup: "Bolsa", isDefault: true })

            expect(mockUpdate).toHaveBeenCalledTimes(1)
            expect(mockUpdate).toHaveBeenCalledWith({ isDefault: false }, { where: { id: { [Op.in]: [1] } } })
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: "Bolsa", isDefault: true }))
        })

        it("sin pedir default, una alternativa más entra como no default", async () => {
            mockFindAll.mockResolvedValue([optionRow(1, "unit", "Bolsa", true)])

            await customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, optionGroup: "Bolsa", isDefault: false })

            expect(mockUpdate).not.toHaveBeenCalled()
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }))
        })

        it("reusa la grafía existente del grupo ('  bolsa ' se une a 'Bolsa')", async () => {
            mockFindAll.mockResolvedValue([optionRow(1, "unit", "Bolsa", true)])

            await customQuotePackagingOptionService.createPackagingOption({ ...UNIT_INPUT, optionGroup: "  bolsa " })

            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ optionGroup: "Bolsa" }))
        })
    })

    describe("editar", () => {
        it("quitarle el default a la fila default de un grupo con más filas -> 409, no guarda", async () => {
            const row = optionRow(1, "unit", "Bolsa", true)
            mockFindOne.mockResolvedValue(row)
            mockFindAll.mockResolvedValue([row, optionRow(2, "unit", "Bolsa", false)])

            await expect(customQuotePackagingOptionService.updatePackagingOption(1, {
                quantity: 1, quantityBasis: null, optionGroup: "Bolsa", isDefault: false
            })).rejects.toMatchObject({ statusCode: 409, key: "errors.material_default_required" })
            expect(row.update).not.toHaveBeenCalled()
        })

        it("mover el default a otro grupo mientras su grupo tiene más filas -> 409", async () => {
            const row = optionRow(1, "unit", "Bolsa", true)
            mockFindOne.mockResolvedValue(row)
            mockFindAll.mockResolvedValue([row, optionRow(2, "unit", "Bolsa", false)])

            await expect(customQuotePackagingOptionService.updatePackagingOption(1, {
                quantity: 1, quantityBasis: null, optionGroup: "Etiqueta", isDefault: true
            })).rejects.toMatchObject({ statusCode: 409 })
        })

        it("editar la cantidad del default sin tocar el grupo se permite", async () => {
            const row = optionRow(1, "unit", "Bolsa", true)
            mockFindOne.mockResolvedValue(row)
            mockFindAll.mockResolvedValue([row, optionRow(2, "unit", "Bolsa", false)])

            await customQuotePackagingOptionService.updatePackagingOption(1, {
                quantity: 2, quantityBasis: "per_unit", optionGroup: "Bolsa", isDefault: true
            })

            expect(row.update).toHaveBeenCalledWith({ quantity: 2, quantityBasis: "per_unit", optionGroup: "Bolsa", isDefault: true })
        })

        it("valida la cantidad contra el nivel del empaque de la fila", async () => {
            mockFindOne.mockResolvedValue(optionRow(1, "pallet", null, false))

            await expect(customQuotePackagingOptionService.updatePackagingOption(1, {
                quantity: 1, quantityBasis: "per_unit", optionGroup: null, isDefault: false
            })).rejects.toMatchObject({ statusCode: 422, key: "errors.custom_quote_packaging_invalid_quantity_basis" })
        })

        it("fila inexistente o inactiva -> 404", async () => {
            await expect(customQuotePackagingOptionService.updatePackagingOption(7, {
                quantity: 1, quantityBasis: null, optionGroup: null, isDefault: false
            })).rejects.toMatchObject({ statusCode: 404 })
        })
    })

    describe("activar / desactivar", () => {
        it("desactivar el default de un grupo con más filas activas -> 409 (clave del nivel)", async () => {
            const row = optionRow(1, "pallet", "Caja", true)
            mockFindOne.mockResolvedValue(row)
            mockFindAll.mockResolvedValue([row, optionRow(2, "pallet", "Caja", false)])

            await expect(customQuotePackagingOptionService.setPackagingOptionStatus(1, false))
                .rejects.toMatchObject({ statusCode: 409, key: "errors.pallet_material_default_deletion_blocked" })
            expect(row.update).not.toHaveBeenCalled()
        })

        it("desactivar la última fila de un grupo se permite", async () => {
            const row = optionRow(1, "pallet", "Caja", true)
            mockFindOne.mockResolvedValue(row)
            mockFindAll.mockResolvedValue([row])

            await customQuotePackagingOptionService.setPackagingOptionStatus(1, false)

            expect(row.update).toHaveBeenCalledWith({ isActive: false })
        })

        it("reactivar en un grupo que ya tiene default vuelve como alternativa, sin quitarle el default a nadie", async () => {
            const row = optionRow(1, "pallet", "Caja", true, { isActive: false })
            mockFindOne.mockResolvedValue(row)
            mockPackagingFindOne.mockResolvedValue(packaging(101, "pallet"))
            mockFindAll.mockResolvedValue([optionRow(2, "pallet", "Caja", true)])

            await customQuotePackagingOptionService.setPackagingOptionStatus(1, true)

            expect(mockUpdate).not.toHaveBeenCalled()
            expect(row.update).toHaveBeenCalledWith({ isActive: true, optionGroup: "Caja", isDefault: false })
        })

        it("reactivar en un grupo vacío vuelve como default", async () => {
            const row = optionRow(1, "pallet", "Caja", false, { isActive: false })
            mockFindOne.mockResolvedValue(row)
            mockPackagingFindOne.mockResolvedValue(packaging(101, "pallet"))

            await customQuotePackagingOptionService.setPackagingOptionStatus(1, true)

            expect(row.update).toHaveBeenCalledWith({ isActive: true, optionGroup: "Caja", isDefault: true })
        })

        it("reactivar con el empaque ya desactivado en el catálogo -> 404", async () => {
            mockFindOne.mockResolvedValue(optionRow(1, "unit", null, false, { isActive: false }))
            mockPackagingFindOne.mockResolvedValue(null)

            await expect(customQuotePackagingOptionService.setPackagingOptionStatus(1, true))
                .rejects.toMatchObject({ statusCode: 404 })
        })
    })

    describe("listar", () => {
        it("filtra por nivel y castea los DECIMAL a número", async () => {
            mockFindAll.mockResolvedValue([
                optionRow(1, "unit", "Bolsa", true),
                optionRow(2, "pallet", null, false),
            ])

            const result = await customQuotePackagingOptionService.listPackagingOptions("pallet")

            expect(result).toEqual([
                expect.objectContaining({ id: 2, level: "pallet", quantity: 2, unitCost: 0.25, quantityBasis: "per_pallet" })
            ])
        })
    })
})
