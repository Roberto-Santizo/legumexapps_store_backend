import "reflect-metadata"

// Mock manual de los 2 modelos que toca este service -- mismo patrón que ingredient.service.ts
// (create/update/delete no necesitan una BD real, solo objetos planos con la forma que el
// service espera de vuelta).
jest.mock("../models/ProcessingCost.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn() }
}))
jest.mock("../models/ProcessingCostTranslation.model", () => ({
    __esModule: true,
    default: { findOrCreate: jest.fn() }
}))

import ProcessingCost from "../models/ProcessingCost.model"
import ProcessingCostTranslation from "../models/ProcessingCostTranslation.model"
import { processingCostService } from "./processingCost.service"
import { NotFoundError } from "../../../shared/errors/AppError"

const mockFindOne = ProcessingCost.findOne as unknown as jest.Mock
const mockCreate = ProcessingCost.create as unknown as jest.Mock
const mockTranslationFindOrCreate = ProcessingCostTranslation.findOrCreate as unknown as jest.Mock

const BASE_INPUT = {
    displayName: "Energía",
    value: 0.15,
    calculationType: "per_weight" as const,
}

describe("processingCostService.createProcessingCost", () => {
    beforeEach(() => {
        mockFindOne.mockReset()
        mockCreate.mockReset()
        mockTranslationFindOrCreate.mockReset()
    })

    it("crea el costo adicional y devuelve el registro recién creado (getProcessingCostById)", async () => {
        mockCreate.mockResolvedValue({ id: 1 })
        mockFindOne.mockResolvedValue({ id: 1, ...BASE_INPUT, isActive: true, translations: [] })

        const result = await processingCostService.createProcessingCost(BASE_INPUT)

        expect(mockCreate).toHaveBeenCalledWith(BASE_INPUT)
        expect(result.displayName).toBe("Energía")
    })

    it("sincroniza la traducción al inglés cuando se manda translations.en.displayName", async () => {
        mockCreate.mockResolvedValue({ id: 1 })
        mockFindOne.mockResolvedValue({ id: 1, ...BASE_INPUT, isActive: true, translations: [] })
        const mockUpdate = jest.fn()
        mockTranslationFindOrCreate.mockResolvedValue([{ update: mockUpdate }])

        await processingCostService.createProcessingCost({
            ...BASE_INPUT,
            translations: { en: { displayName: "Energy" } },
        })

        expect(mockTranslationFindOrCreate).toHaveBeenCalledWith({
            where: { processingCostId: 1, language: "en" },
            defaults: { processingCostId: 1, language: "en", displayName: "Energy" },
        })
        expect(mockUpdate).toHaveBeenCalledWith({ displayName: "Energy" })
    })

    it("NO toca la tabla de traducciones si no se manda translations.en", async () => {
        mockCreate.mockResolvedValue({ id: 1 })
        mockFindOne.mockResolvedValue({ id: 1, ...BASE_INPUT, isActive: true, translations: [] })

        await processingCostService.createProcessingCost(BASE_INPUT)

        expect(mockTranslationFindOrCreate).not.toHaveBeenCalled()
    })
})

describe("processingCostService.updateProcessingCost", () => {
    beforeEach(() => {
        mockFindOne.mockReset()
        mockTranslationFindOrCreate.mockReset()
    })

    it("rechaza actualizar un costo adicional que no existe (NotFoundError)", async () => {
        mockFindOne.mockResolvedValue(null)

        await expect(processingCostService.updateProcessingCost(999, { value: 1, calculationType: "per_weight" })).rejects.toBeInstanceOf(
            NotFoundError
        )
    })

    it("actualiza los campos y vuelve a sincronizar la traducción al inglés", async () => {
        const mockRecordUpdate = jest.fn().mockResolvedValue(undefined)
        mockFindOne.mockResolvedValue({ id: 1, ...BASE_INPUT, isActive: true, update: mockRecordUpdate, translations: [] })
        const mockTranslationUpdate = jest.fn()
        mockTranslationFindOrCreate.mockResolvedValue([{ update: mockTranslationUpdate }])

        await processingCostService.updateProcessingCost(1, {
            value: 0.2,
            calculationType: "per_weight",
            translations: { en: { displayName: "Energy (updated)" } },
        })

        expect(mockRecordUpdate).toHaveBeenCalledWith({ value: 0.2, calculationType: "per_weight" })
        expect(mockTranslationUpdate).toHaveBeenCalledWith({ displayName: "Energy (updated)" })
    })
})

describe("processingCostService.deleteProcessingCost", () => {
    beforeEach(() => {
        mockFindOne.mockReset()
    })

    it("desactiva (isActive:false) en vez de borrar la fila -- mismo patrón que el resto del repo", async () => {
        const mockRecordUpdate = jest.fn().mockResolvedValue(undefined)
        mockFindOne.mockResolvedValue({ id: 1, ...BASE_INPUT, isActive: true, update: mockRecordUpdate })

        await processingCostService.deleteProcessingCost(1)

        expect(mockRecordUpdate).toHaveBeenCalledWith({ isActive: false })
    })

    it("rechaza desactivar un costo adicional que no existe (NotFoundError)", async () => {
        mockFindOne.mockResolvedValue(null)

        await expect(processingCostService.deleteProcessingCost(999)).rejects.toBeInstanceOf(NotFoundError)
    })
})
