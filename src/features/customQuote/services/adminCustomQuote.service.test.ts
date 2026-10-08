import "reflect-metadata"
import { Op } from "sequelize"

jest.mock("../models/CustomQuote.model", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn() } }))

import CustomQuote from "../models/CustomQuote.model"
import { adminCustomQuoteService } from "./adminCustomQuote.service"

const mockFindAll = CustomQuote.findAll as unknown as jest.Mock
const mockFindOne = CustomQuote.findOne as unknown as jest.Mock

// Fila tal como la devuelve Sequelize: DECIMALs como string, timestamps vía get().
function storedRow(overrides: Record<string, unknown> = {}) {
    const data: Record<string, unknown> = {
        id: 5,
        status: "new",
        salespersonId: 42,
        subCategoryId: 3,
        presentationId: 7,
        destinationId: 9,
        productDisplayName: "A la medida · 60% Piña · 40% Mango",
        variantLabel: "12 und × 500 g · 40 cajas/palet",
        isOrganic: false,
        requestedPallets: 2,
        totalUnits: 960,
        boxesPerPallet: 40,
        bagsPerBox: 12,
        unitsPerIntermediatePackage: null,
        rawMaterialCost: "100.1234",
        ingredientCost: "1.0000",
        unitPackagingCost: "20.0000",
        intermediatePackagingCost: "0.0000",
        processingCostTotal: "3.5000",
        palletMaterialCost: "40.0000",
        percentageCostTotal: "8.2000",
        transportCost: "150.0000",
        adjustmentCost: "0.0000",
        totalCost: "322.8234",
        configuration: { presentationId: 7 },
        breakdown: { rawMaterials: [] },
        createdAt: new Date("2026-09-29T15:00:00.000Z"),
        updatedAt: new Date("2026-09-29T16:00:00.000Z"),
        requestingSalesperson: { id: 42, name: "Rep Uno", companyName: null, email: "uno@legumex.com" },
        subCategory: { displayName: "Mezclas de fruta", translations: [{ language: "en", displayName: "Fruit mixes" }] },
        presentation: { displayLabel: "500 g" },
        destination: { displayName: "Puerto Quetzal" },
        ...overrides,
    }
    return { ...data, get: (key: string) => data[key], update: jest.fn() }
}

describe("adminCustomQuoteService.listCustomQuotes", () => {
    beforeEach(() => {
        mockFindAll.mockResolvedValue([])
    })

    function sentWhere() {
        return mockFindAll.mock.calls[0][0].where
    }

    it("sin filtros: sin where, más reciente primero, con representante/subcategoría/presentación", async () => {
        await adminCustomQuoteService.listCustomQuotes()

        const args = mockFindAll.mock.calls[0][0]
        expect(args.where).toEqual({})
        expect(args.order).toEqual([["createdAt", "DESC"]])
        expect(args.include.map((include: { as: string }) => include.as)).toEqual(["requestingSalesperson"])
    })

    it("rango: límites de día en hora de Guatemala sobre createdAt", async () => {
        await adminCustomQuoteService.listCustomQuotes({ startDate: "2026-09-01", endDate: "2026-09-10" })

        const createdAt = sentWhere().createdAt
        expect(createdAt[Op.gte]).toEqual(new Date("2026-09-01T06:00:00.000Z"))
        expect(createdAt[Op.lte]).toEqual(new Date("2026-09-11T05:59:59.999Z"))
    })

    it("solo inicio / solo fin", async () => {
        await adminCustomQuoteService.listCustomQuotes({ startDate: "2026-09-01" })
        expect(sentWhere().createdAt[Op.lte]).toBeUndefined()

        mockFindAll.mockClear()
        await adminCustomQuoteService.listCustomQuotes({ endDate: "2026-09-10" })
        expect(sentWhere().createdAt[Op.gte]).toBeUndefined()
    })

    it("filtra por estado", async () => {
        await adminCustomQuoteService.listCustomQuotes({ status: "in_development" })
        expect(sentWhere()).toEqual({ status: "in_development" })
    })

    it("el DTO castea el total y no inventa contexto histórico desde el catálogo actual", async () => {
        mockFindAll.mockResolvedValue([storedRow()])

        const [item] = await adminCustomQuoteService.listCustomQuotes({}, "en")

        expect(item).toEqual({
            id: 5,
            status: "new",
            createdAt: new Date("2026-09-29T15:00:00.000Z"),
            updatedAt: new Date("2026-09-29T16:00:00.000Z"),
            salesperson: { id: 42, name: "Rep Uno", companyName: null, email: "uno@legumex.com" },
            subCategoryId: 3,
            subCategoryName: null,
            presentationId: 7,
            presentationLabel: "12 und × 500 g · 40 cajas/palet",
            productDisplayName: "A la medida · 60% Piña · 40% Mango",
            variantLabel: "12 und × 500 g · 40 cajas/palet",
            isOrganic: false,
            requestedPallets: 2,
            totalUnits: 960,
            totalCost: 322.8234,
        })
    })
})

describe("adminCustomQuoteService.getCustomQuoteById", () => {
    it.each([1, 2])("snapshot version %s opens without consulting option tables or current catalogs", async version => {
        const configuration = version === 1
            ? { presentationId: 7, rawMaterialMix: [{ rawMaterialId: 123, percentage: 100 }], packaging: { unit: [{ packagingOptionId: 456, packagingId: 789, quantity: 1 }] } }
            : { snapshot: { schemaVersion: 2, subCategory: { displayName: "Frozen subcategory" }, presentation: { displayLabel: "Frozen presentation" } } }
        const breakdown = { rawMaterials: [{ rawMaterialId: 123, displayName: "Historical fruit", cost: 100.1234 }], unitPackagings: [{ packagingId: 789, displayName: "Historical bag", cost: 20 }] }
        mockFindOne.mockResolvedValue(storedRow({ configuration, breakdown, subCategory: null, presentation: null, destination: null }))
        const detail = await adminCustomQuoteService.getCustomQuoteById(5)
        expect(detail.configuration).toEqual(configuration)
        expect(detail.breakdown).toEqual(breakdown)
        expect(mockFindOne.mock.calls[0][0].include.map((include: { as: string }) => include.as)).toEqual(["requestingSalesperson"])
    })
    it("reads frozen names even when catalog labels have changed", async () => {
        mockFindOne.mockResolvedValue(storedRow({ configuration: { snapshot: { schemaVersion: 2, subCategory: { displayName: "Frozen subcategory" }, presentation: { displayLabel: "Frozen presentation" } } } }))
        const detail = await adminCustomQuoteService.getCustomQuoteById(5)
        expect(detail.subCategoryName).toBe("Frozen subcategory")
        expect(detail.presentationLabel).toBe("Frozen presentation")
    })
    it("inexistente -> 404", async () => {
        mockFindOne.mockResolvedValue(null)
        await expect(adminCustomQuoteService.getCustomQuoteById(99)).rejects.toMatchObject({ statusCode: 404 })
    })

    it("detalle completo: todas las columnas de costo casteadas, cuentas, destino, configuración y desglose", async () => {
        mockFindOne.mockResolvedValue(storedRow())

        const detail = await adminCustomQuoteService.getCustomQuoteById(5)

        expect(mockFindOne.mock.calls[0][0].where).toEqual({ id: 5 })
        expect(detail).toMatchObject({
            rawMaterialCost: 100.1234,
            ingredientCost: 1,
            unitPackagingCost: 20,
            intermediatePackagingCost: 0,
            processingCostTotal: 3.5,
            palletMaterialCost: 40,
            percentageCostTotal: 8.2,
            transportCost: 150,
            adjustmentCost: 0,
            totalCost: 322.8234,
            destinationId: 9,
            destinationName: null,
            boxesPerPallet: 40,
            bagsPerBox: 12,
            unitsPerIntermediatePackage: null,
            subCategoryName: null,
            configuration: { presentationId: 7 },
            breakdown: { rawMaterials: [] },
        })
    })
})

describe("adminCustomQuoteService.setCustomQuoteStatus", () => {
    it("inexistente -> 404", async () => {
        mockFindOne.mockResolvedValue(null)
        await expect(adminCustomQuoteService.setCustomQuoteStatus(99, "reviewed")).rejects.toMatchObject({ statusCode: 404 })
    })

    it("solo cambia el estado", async () => {
        const row = storedRow()
        mockFindOne.mockResolvedValue(row)

        const result = await adminCustomQuoteService.setCustomQuoteStatus(5, "discarded")

        expect(row.update).toHaveBeenCalledWith({ status: "discarded" })
        expect(result).toEqual({ id: 5, status: "discarded" })
    })
})
