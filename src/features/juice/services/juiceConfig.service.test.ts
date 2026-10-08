jest.mock("../models/JuiceCostConstants.model", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceClientConstantOverride.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() } }))
jest.mock("./juiceCatalog.service", () => ({ requireJuiceClient: jest.fn() }))

import { OptimisticLockError, UniqueConstraintError } from "sequelize"
import Global from "../models/JuiceCostConstants.model"
import Override from "../models/JuiceClientConstantOverride.model"
import { JUICE_CONSTANT_FIELDS } from "../constants/juice.constant"
import { requireJuiceClient } from "./juiceCatalog.service"
import { juiceConfigService as service } from "./juiceConfig.service"

const input = Object.fromEntries(JUICE_CONSTANT_FIELDS.map(key => [key, key === "palletsPerContainer" ? 20 : key.endsWith("Rate") ? 0.02 : 1]))
function row(values: Record<string, unknown>) {
    const instance = { ...values, toJSON: () => values, update: jest.fn() }
    instance.update.mockImplementation(async (patch: Record<string, unknown>) => row({ ...values, ...patch }))
    return instance
}
beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(Global.findOne).mockResolvedValue(row({ ...input, revision: 4 }) as never)
    jest.mocked(Override.findOne).mockResolvedValue(null)
})

describe("layered juice constants", () => {
    test("resolves every global and its revision when no active override exists", async () => {
        expect(await service.resolveConstants(1)).toEqual({ values: input, globalRevision: 4, sources: Object.fromEntries(JUICE_CONSTANT_FIELDS.map(key => [key, "global"])) })
        expect(Override.findOne).toHaveBeenCalledWith({ where: { clientId: 1, isActive: true } })
    })
    test.each(JUICE_CONSTANT_FIELDS)("resolves nullable/zero override for %s independently", async key => {
        jest.mocked(Override.findOne).mockResolvedValue(row({ [key]: key === "palletsPerContainer" ? "25" : "0" }) as never)
        const resolved = await service.resolveConstants(1)
        expect(resolved.values[key]).toBe(key === "palletsPerContainer" ? 25 : 0)
        expect(resolved.sources[key]).toBe("client")
        jest.mocked(Override.findOne).mockResolvedValue(row({ [key]: null }) as never)
        const inherited = await service.resolveConstants(1)
        expect(inherited.values[key]).toBe(input[key])
        expect(inherited.sources[key]).toBe("global")
    })
    test("missing global configuration fails rather than supplying guessed defaults", async () => {
        jest.mocked(Global.findOne).mockResolvedValue(null)
        await expect(service.resolveConstants(1)).rejects.toMatchObject({ statusCode: 422, key: "errors.juice_config_required" })
    })
    test("rejects an inactive client before resolving constants", async () => {
        jest.mocked(requireJuiceClient).mockRejectedValue(new Error("inactive client"))
        await expect(service.resolveConstants(7)).rejects.toThrow("inactive client")
        expect(Global.findOne).not.toHaveBeenCalled()
    })
    test("singleton creation rejects existing and concurrent records", async () => {
        await expect(service.createGlobal(input)).rejects.toMatchObject({ statusCode: 409 })
        jest.mocked(Global.findOne).mockResolvedValue(null)
        jest.mocked(Global.create).mockRejectedValue(new UniqueConstraintError({}))
        await expect(service.createGlobal(input)).rejects.toMatchObject({ key: "errors.juice_config_already_exists" })
    })
    test("optimistic version conflict returns an actionable conflict", async () => {
        const global = row({ ...input, revision: 4 })
        global.update.mockRejectedValue(new OptimisticLockError({}))
        jest.mocked(Global.findOne).mockResolvedValue(global as never)
        await expect(service.updateGlobal(input)).rejects.toMatchObject({ statusCode: 409, key: "errors.juice_config_conflict" })
    })
    test("partial override update only writes explicit fields and can restore inheritance", async () => {
        const override = row({ clientId: 1, freightPerContainer: "20", hppPerPound: "0.1" })
        jest.mocked(Override.findOne).mockResolvedValue(override as never)
        await expect(service.updateOverride(1, { freightPerContainer: null })).resolves.toMatchObject({ freightPerContainer: null, hppPerPound: 0.1 })
        expect(override.update).toHaveBeenCalledWith({ freightPerContainer: null })
    })
    test("inactive override retains unique ownership and must be reactivated", async () => {
        jest.mocked(Override.findOne).mockResolvedValue(row({ clientId: 1, isActive: false }) as never)
        await expect(service.createOverride({ clientId: 1, freightPerContainer: 0 })).rejects.toMatchObject({ statusCode: 409 })
        expect(Override.create).not.toHaveBeenCalled()
        await expect(service.setOverrideStatus(1, true)).resolves.toMatchObject({ isActive: true })
    })
})
