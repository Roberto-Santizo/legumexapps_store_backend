jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn((operation: (transaction: unknown) => unknown) => operation({ LOCK: { UPDATE: "UPDATE" } })) } }))
jest.mock("../../client/models/Client.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../models/Juice.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceRawMaterial.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuicePresentation.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceMix.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceSpiceMaterial.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceSpice.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../../../shared/utils/catalogImage.util", () => ({ resolveCatalogImage: jest.fn().mockResolvedValue(undefined) }))
jest.mock("../../../shared/utils/slug.util", () => ({ generateUniqueSlug: jest.fn().mockResolvedValue("carrot-pineapple") }))

import { Op, UniqueConstraintError } from "sequelize"
import Client from "../../client/models/Client.model"
import Juice from "../models/Juice.model"
import Raw from "../models/JuiceRawMaterial.model"
import Mix from "../models/JuiceMix.model"
import Presentation from "../models/JuicePresentation.model"
import Spice from "../models/JuiceSpice.model"
import SpiceMaterial from "../models/JuiceSpiceMaterial.model"
import { juiceRawMaterialService, juiceService, juiceMixService, juiceSpiceService, juicePresentationService } from "./juiceCatalog.service"
import { juiceDto } from "./juiceDto"

const rawInput = { code: "CARROT", displayName: "Carrot", purchaseUnit: "LIBRA", yieldPoundsPerLiter: 2.2046, costPerUnit: 0.123456 }
function row(values: Record<string, unknown>) {
    const instance = { ...values, toJSON: () => values, update: jest.fn() }
    instance.update.mockImplementation(async (input: Record<string, unknown>) => row({ ...values, ...input }))
    return instance
}

beforeEach(() => {
    jest.resetAllMocks()
    // resetAllMocks resets transaction/image implementations as well.
    const connection = jest.requireMock("../../../database/connection").default
    connection.transaction.mockImplementation((operation: (transaction: unknown) => unknown) => operation({ LOCK: { UPDATE: "UPDATE" } }))
    jest.requireMock("../../../shared/utils/catalogImage.util").resolveCatalogImage.mockResolvedValue(undefined)
    jest.requireMock("../../../shared/utils/slug.util").generateUniqueSlug.mockResolvedValue("carrot-pineapple")
    jest.mocked(Client.findOne).mockResolvedValue(row({ id: 1 }) as never)
    jest.mocked(Juice.findOne).mockResolvedValue(row({ id: 1 }) as never)
    jest.mocked(Raw.findOne).mockResolvedValue(null)
    jest.mocked(Mix.findOne).mockResolvedValue(null)
    jest.mocked(Mix.findAll).mockResolvedValue([])
    jest.mocked(Raw.create).mockImplementation(async values => row({ id: 1, ...values }) as never)
    jest.mocked(Mix.create).mockImplementation(async values => row({ id: 1, ...values }) as never)
})

describe("juice catalog domain validation", () => {
    test("stores the source cost/liter without four-place truncation", async () => {
        await expect(juiceRawMaterialService.create({ ...rawInput, yieldPoundsPerLiter: 1, costPerUnit: 1.87391 })).resolves.toMatchObject({ costPerLiter: 1.87391 })
    })
    test.each(["LIBRA", "LITRO", "GRAMO"])("computes cost/liter without invented %s conversion", async purchaseUnit => {
        const result = await juiceRawMaterialService.create({ ...rawInput, purchaseUnit })
        expect(result).toMatchObject({ costPerLiter: 0.2721710976, purchaseUnit })
    })
    test("checks code uniqueness across inactive rows before writing", async () => {
        jest.mocked(Raw.findOne).mockResolvedValue(row({ id: 8, isActive: false }) as never)
        await expect(juiceRawMaterialService.create(rawInput)).rejects.toMatchObject({ statusCode: 409, key: "errors.juice_duplicate" })
        expect(Raw.create).not.toHaveBeenCalled()
        expect(Raw.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ [Op.and]: expect.any(Array) }) }))
    })
    test("translates a concurrent database uniqueness collision", async () => {
        jest.mocked(Raw.create).mockRejectedValue(new UniqueConstraintError({}))
        await expect(juiceRawMaterialService.create(rawInput)).rejects.toMatchObject({ statusCode: 409 })
    })
    test("rejects derived cost overflow", async () => {
        await expect(juiceRawMaterialService.create({ ...rawInput, yieldPoundsPerLiter: 100000, costPerUnit: 100000 })).rejects.toMatchObject({ key: "errors.juice_cost_out_of_range" })
    })
    test("recomputes cost on edits and excludes the current id in uniqueness lookup", async () => {
        const existing = row({ id: 3, ...rawInput, costPerLiter: "0.2722" })
        jest.mocked(Raw.findOne).mockResolvedValueOnce(existing as never).mockResolvedValueOnce(null)
        expect(await juiceRawMaterialService.update(3, { ...rawInput, costPerUnit: 2 })).toMatchObject({ costPerLiter: 4.4092 })
        expect(Raw.findOne).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ id: { [Op.ne]: 3 } }) }))
    })
    test("juice validates active client, generates slug and delegates image handling", async () => {
        jest.mocked(Juice.findOne).mockResolvedValue(null)
        jest.mocked(Juice.create).mockImplementation(async values => row({ id: 1, ...values }) as never)
        const result = await juiceService.create({ code: "CP", displayName: "Carrot Pineapple", clientId: 1, pricePerPound: 2 })
        expect(result).toMatchObject({ urlSlug: "carrot-pineapple", imageUrl: null, pricePerPound: 2 })
        expect(Client.findOne).toHaveBeenCalledWith({ where: { id: 1, isActive: true } })
        expect(jest.requireMock("../../../shared/utils/catalogImage.util").resolveCatalogImage).toHaveBeenCalledWith(undefined, undefined, "juices")
    })
    test("juice rejects an inactive/missing client", async () => {
        jest.mocked(Juice.findOne).mockResolvedValue(null)
        jest.mocked(Client.findOne).mockResolvedValue(null)
        await expect(juiceService.create({ code: "CP", displayName: "CP", clientId: 7, pricePerPound: 2 })).rejects.toMatchObject({ statusCode: 404, params: { resource: "Client", id: 7 } })
    })
    test("mix locks its parent and accepts an incomplete recipe while building", async () => {
        jest.mocked(Raw.findOne).mockResolvedValue(row({ id: 2 }) as never)
        await expect(juiceMixService.create({ juiceId: 1, rawMaterialId: 2, percentage: 40 })).resolves.toMatchObject({ percentage: 40 })
        expect(Juice.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: "UPDATE", transaction: expect.any(Object) }))
    })
    test("mix ceiling uses decimals and permits exactly 100", async () => {
        jest.mocked(Raw.findOne).mockResolvedValue(row({ id: 2 }) as never)
        jest.mocked(Mix.findAll).mockResolvedValue([row({ percentage: "33.333333" }) as never])
        await expect(juiceMixService.create({ juiceId: 1, rawMaterialId: 2, percentage: 66.666667 })).resolves.toBeDefined()
        await expect(juiceMixService.create({ juiceId: 1, rawMaterialId: 2, percentage: 66.666668 })).rejects.toMatchObject({ key: "errors.juice_mix_ceiling" })
    })
    test("mix reactivation checks ceiling and preserves a rejected row's status", async () => {
        const inactive = row({ id: 4, juiceId: 1, rawMaterialId: 2, percentage: "60", isActive: false })
        jest.mocked(Mix.findOne).mockResolvedValue(inactive as never)
        jest.mocked(Raw.findOne).mockResolvedValue(row({ id: 2 }) as never)
        jest.mocked(Mix.findAll).mockResolvedValue([row({ percentage: "50" }) as never])
        await expect(juiceMixService.setStatus(4, true)).rejects.toMatchObject({ statusCode: 422 })
        expect(inactive.update).not.toHaveBeenCalled()
        expect(Mix.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { [Op.ne]: 4 } }) }))
    })
    test("mix rejects inactive raw material", async () => {
        await expect(juiceMixService.create({ juiceId: 1, rawMaterialId: 2, percentage: 50 })).rejects.toMatchObject({ params: { resource: "JuiceRawMaterial" } })
    })
    test("spice grams are per liter and require an active spice catalog entry", async () => {
        jest.mocked(Spice.findOne).mockResolvedValue(null)
        jest.mocked(SpiceMaterial.findOne).mockResolvedValue(null)
        await expect(juiceSpiceService.create({ juiceId: 1, spiceMaterialId: 2, gramsPerLiter: 1.5 })).rejects.toMatchObject({ statusCode: 404 })
        jest.mocked(SpiceMaterial.findOne).mockResolvedValue(row({ id: 2 }) as never)
        jest.mocked(Spice.create).mockImplementation(async values => row({ ...values }) as never)
        await expect(juiceSpiceService.create({ juiceId: 1, spiceMaterialId: 2, gramsPerLiter: 1.5 })).resolves.toMatchObject({ gramsPerLiter: 1.5 })
    })
    test("soft delete can deactivate an orphaned presentation; scoped list includes inactive rows", async () => {
        const existing = row({ id: 2, juiceId: 1, isActive: true })
        jest.mocked(Presentation.findOne).mockResolvedValue(existing as never)
        await expect(juicePresentationService.setStatus(2, false)).resolves.toMatchObject({ isActive: false })
        expect(Juice.findOne).not.toHaveBeenCalled()
        jest.mocked(Presentation.findAll).mockResolvedValue([existing as never])
        await juicePresentationService.list(1)
        expect(Presentation.findAll).toHaveBeenCalledWith({ where: { juiceId: 1 }, order: [["isActive", "DESC"], ["id", "DESC"]] })
    })
    test("DTO converts decimal strings, preserves null and nested model rows", () => {
        expect(juiceDto(row({ costPerLiter: "1.2500", imageUrl: null, presentations: [row({ mlPerBottle: "354.000" })] }))).toEqual({ costPerLiter: 1.25, imageUrl: null, presentations: [{ mlPerBottle: 354 }] })
    })
})
