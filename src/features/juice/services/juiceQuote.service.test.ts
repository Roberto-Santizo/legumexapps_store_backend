jest.mock("../models/Juice.model", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn(), update: jest.fn() } }))
jest.mock("../models/JuicePresentation.model", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceMix.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceRawMaterial.model", () => ({ __esModule: true, default: {} }))
jest.mock("../models/JuiceSpice.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceSpiceMaterial.model", () => ({ __esModule: true, default: {} }))
jest.mock("./juiceConfig.service", () => ({ juiceConfigService: { resolveConstants: jest.fn() } }))

import Juice from "../models/Juice.model"
import Presentation from "../models/JuicePresentation.model"
import Mix from "../models/JuiceMix.model"
import Raw from "../models/JuiceRawMaterial.model"
import Spice from "../models/JuiceSpice.model"
import SpiceMaterial from "../models/JuiceSpiceMaterial.model"
import { juiceConfigService } from "./juiceConfig.service"
import { calculateJuiceQuote } from "./juiceQuote.service"
import { parityRecipe as recipe, parityPhysical as physical, parityConstants as constants } from "./juiceParity.fixture"
import { JUICE_CONSTANT_FIELDS } from "../constants/juice.constant"

beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(Juice.findOne).mockResolvedValue({ id: 10, clientId: 3, displayName: "CARROT PINEAPPLE JUICE", pricePerPound: "2.025852" } as never)
    jest.mocked(Presentation.findOne).mockResolvedValue({ id: 20, juiceId: 10, displayLabel: "6x354 ML", ...physical } as never)
    jest.mocked(Mix.findAll).mockResolvedValue(recipe.rawMaterials.map(row => ({ ...row, rawMaterial: { isActive: true, displayName: row.displayName, costPerLiter: row.costPerLiter } })) as never)
    jest.mocked(Spice.findAll).mockResolvedValue(recipe.spices.map(row => ({ ...row, spiceMaterial: { isActive: true, displayName: row.displayName, costPerGram: row.costPerGram } })) as never)
    jest.mocked(juiceConfigService.resolveConstants).mockResolvedValue({ values: constants, sources: Object.fromEntries(JUICE_CONSTANT_FIELDS.map(key => [key, "global"])) as never, globalRevision: 2 })
})

describe("calculateJuiceQuote catalog-backed engine", () => {
    test("loads complete active recipe associations, resolves external client and reproduces corrected parity", async () => {
        const result = await calculateJuiceQuote(10, 20, 1)
        expect(result).toMatchObject({ juiceId: 10, presentationId: 20, clientId: 3, pricePerCase: 9.1678, pricePerPound: 1.9579, configuration: { globalRevision: 2 } })
        expect(Juice.findOne).toHaveBeenCalledWith({ where: { id: 10, isActive: true } })
        expect(Presentation.findOne).toHaveBeenCalledWith({ where: { id: 20, juiceId: 10, isActive: true } })
        expect(Mix.findAll).toHaveBeenCalledWith({ where: { juiceId: 10, isActive: true }, order: [["id", "ASC"]], include: [{ model: Raw, as: "rawMaterial", required: false }] })
        expect(Spice.findAll).toHaveBeenCalledWith({ where: { juiceId: 10, isActive: true }, order: [["id", "ASC"]], include: [{ model: SpiceMaterial, as: "spiceMaterial", required: false }] })
        expect(juiceConfigService.resolveConstants).toHaveBeenCalledWith(3)
        expect(Juice.create).not.toHaveBeenCalled()
        expect(Juice.update).not.toHaveBeenCalled()
        expect(Presentation.create).not.toHaveBeenCalled()
        expect(Mix.create).not.toHaveBeenCalled()
        expect(Spice.create).not.toHaveBeenCalled()
    })
    test("missing/inactive juice fails before child lookups", async () => {
        jest.mocked(Juice.findOne).mockResolvedValue(null)
        await expect(calculateJuiceQuote(10, 20, 1)).rejects.toMatchObject({ statusCode: 404, params: { resource: "Juice" } })
        expect(Presentation.findOne).not.toHaveBeenCalled()
    })
    test("missing/inactive/mismatched presentation fails before costing", async () => {
        jest.mocked(Presentation.findOne).mockResolvedValue(null)
        await expect(calculateJuiceQuote(10, 20, 1)).rejects.toMatchObject({ statusCode: 404, params: { resource: "JuicePresentation" } })
        expect(Mix.findAll).not.toHaveBeenCalled()
    })
    test.each([null, { isActive: false }])("rejects missing/inactive raw associations without hiding their recipe rows", async rawMaterial => {
        jest.mocked(Mix.findAll).mockResolvedValue([{ percentage: 100, rawMaterial }] as never)
        await expect(calculateJuiceQuote(10, 20, 1)).rejects.toMatchObject({ key: "errors.juice_invalid_recipe" })
        expect(juiceConfigService.resolveConstants).not.toHaveBeenCalled()
    })
    test("rejects inactive spices rather than silently dropping their contribution", async () => {
        jest.mocked(Spice.findAll).mockResolvedValue([{ spiceMaterial: { isActive: false } }] as never)
        await expect(calculateJuiceQuote(10, 20, 1)).rejects.toMatchObject({ statusCode: 422 })
    })
    test("requires 100% active recipe but spices may be absent", async () => {
        jest.mocked(Mix.findAll).mockResolvedValue([])
        await expect(calculateJuiceQuote(10, 20, 1)).rejects.toMatchObject({ key: "errors.juice_mix_incomplete" })
        jest.mocked(Mix.findAll).mockResolvedValue(recipe.rawMaterials.map(row => ({ ...row, rawMaterial: { isActive: true, displayName: row.displayName, costPerLiter: row.costPerLiter } })) as never)
        jest.mocked(Spice.findAll).mockResolvedValue([])
        await expect(calculateJuiceQuote(10, 20, 1)).resolves.toMatchObject({ spiceCostPerLiter: 0 })
    })
    test("uses resolved client overrides including zero and freezes their source", async () => {
        jest.mocked(juiceConfigService.resolveConstants).mockResolvedValue({ values: { ...constants, freightPerContainer: 0 }, sources: { ...Object.fromEntries(JUICE_CONSTANT_FIELDS.map(key => [key, "global"])), freightPerContainer: "client" } as never, globalRevision: 3 })
        const result = await calculateJuiceQuote(10, 20, 1)
        expect(result.lines.find(row => row.key === "containerFreight")?.costPerPound).toBe(0)
        expect(result.configuration.sources.freightPerContainer).toBe("client")
    })
    test("propagates missing global config and inactive-client errors", async () => {
        jest.mocked(juiceConfigService.resolveConstants).mockRejectedValue(new Error("global config missing"))
        await expect(calculateJuiceQuote(10, 20, 1)).rejects.toThrow("global config missing")
    })
    test("rejects invalid quantity and ids before model calls", async () => {
        await expect(calculateJuiceQuote(10, 20, 0)).rejects.toThrow()
        await expect(calculateJuiceQuote(-1, 20, 1)).rejects.toThrow()
        expect(Juice.findOne).not.toHaveBeenCalled()
    })
})
