import "reflect-metadata"

// Mock manual del modelo -- mismo patrón que el resto de los *.service.test.ts de este repo.
jest.mock("../models/Unit.model", () => ({
    __esModule: true,
    default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() }
}))

import Unit from "../models/Unit.model"
import { unitService } from "./unit.service"

const mockFindAll = Unit.findAll as unknown as jest.Mock
const mockFindOne = Unit.findOne as unknown as jest.Mock
const mockCreate = Unit.create as unknown as jest.Mock

describe("unitService.findOrCreatePoundUnit", () => {
    beforeEach(() => {
        mockFindAll.mockReset()
        mockFindOne.mockReset()
        mockCreate.mockReset()
    })

    it("devuelve la Libra existente si ya hay una fila de peso con baseFactor 453.592 (match por baseFactor, no por nombre)", async () => {
        mockFindAll.mockResolvedValue([
            { id: 7, displayName: "Cualquier Nombre Editado", unitType: "weight", baseFactor: "453.592000" },
        ])

        const result = await unitService.findOrCreatePoundUnit()

        expect(result).toEqual(expect.objectContaining({ id: 7 }))
        expect(mockFindAll).toHaveBeenCalledWith({ where: { unitType: "weight", isActive: true } })
        expect(mockCreate).not.toHaveBeenCalled()
    })

    it("ignora otras unidades de peso con un baseFactor distinto (ej. Kilogramo) y no las confunde con la Libra", async () => {
        mockFindAll.mockResolvedValue([
            { id: 3, displayName: "Kilogramo", unitType: "weight", baseFactor: "1000.000000" },
        ])
        mockFindOne.mockResolvedValue(null) // ningún unitCode "libra" ya existe
        mockCreate.mockResolvedValue({ id: 9, displayName: "Libra" })

        const result = await unitService.findOrCreatePoundUnit()

        expect(result).toEqual(expect.objectContaining({ id: 9 }))
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            displayName: "Libra",
            unitType: "weight",
            baseFactor: 453.592,
        }))
    })

    it("crea la Libra si no existe ninguna fila de peso todavía (BD recién sembrada)", async () => {
        mockFindAll.mockResolvedValue([])
        mockFindOne.mockResolvedValue(null)
        mockCreate.mockResolvedValue({ id: 1, displayName: "Libra" })

        const result = await unitService.findOrCreatePoundUnit()

        expect(result).toEqual(expect.objectContaining({ id: 1 }))
        expect(mockCreate).toHaveBeenCalledTimes(1)
    })
})
