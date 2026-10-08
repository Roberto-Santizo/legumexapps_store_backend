jest.mock("../../product/models/ProductVariantPalletMaterial.model", () => ({ __esModule: true, default: { update: jest.fn(), findAll: jest.fn().mockResolvedValue([]) } }))
jest.mock("../models/PackagingGroup.model", () => ({ __esModule: true, default: {
    findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(),
    sequelize: { transaction: jest.fn() },
} }))
jest.mock("../../product/models/ProductVariantUnitMaterial.model", () => ({ __esModule: true, default: { update: jest.fn() } }))
import PackagingGroup from "../models/PackagingGroup.model"
import PalletMaterial from "../../product/models/ProductVariantPalletMaterial.model"
import UnitMaterial from "../../product/models/ProductVariantUnitMaterial.model"
import { packagingGroupService, resolveUnitMaterialGroup } from "./packagingGroup.service"

const findOne = jest.mocked(PackagingGroup.findOne)
const findByPk = jest.mocked(PackagingGroup.findByPk)
const create = PackagingGroup.create as unknown as jest.Mock
const transaction = PackagingGroup.sequelize!.transaction as unknown as jest.Mock
const rowUpdate = jest.fn()
const group = () => ({ id: 4, displayName: "Caja", nameKey: "caja", isActive: true, update: rowUpdate }) as unknown as PackagingGroup

describe("packagingGroupService", () => {
    beforeEach(() => {
        jest.clearAllMocks()
        findOne.mockResolvedValue(null)
        findByPk.mockResolvedValue(group())
        rowUpdate.mockResolvedValue(group())
        transaction.mockImplementation(async callback => callback({ LOCK: { UPDATE: "UPDATE" } }))
    })

    it("creates a catalog entry with collapsed spaces and a unique case-insensitive key", async () => {
        await packagingGroupService.create("  Caja   exterior  ")
        expect(create).toHaveBeenCalledWith({ displayName: "Caja exterior", nameKey: "caja exterior" })
    })
    it("rejects duplicate names including inactive entries", async () => {
        findOne.mockResolvedValue({ ...group(), isActive: false } as PackagingGroup)
        await expect(packagingGroupService.create("CAJA")).rejects.toMatchObject({ statusCode: 409 })
        expect(create).not.toHaveBeenCalled()
    })
    it("renames the label transactionally without changing group identity or snapshots", async () => {
        await packagingGroupService.update(4, "Caja exterior")
        expect(PalletMaterial.update).toHaveBeenCalledWith({ optionGroup: "Caja exterior" }, expect.objectContaining({ where: { optionGroupId: 4 }, transaction: expect.anything() }))
        expect(rowUpdate).toHaveBeenCalledWith({ displayName: "Caja exterior", nameKey: "caja exterior" }, expect.objectContaining({ transaction: expect.anything() }))
        expect(UnitMaterial.update).toHaveBeenCalledWith({ optionGroup: "Caja exterior" }, expect.objectContaining({ where: { optionGroupId: 4 }, transaction: expect.anything() }))
    })
    it("deactivates without modifying existing associations", async () => {
        await packagingGroupService.status(4, false)
        expect(rowUpdate).toHaveBeenCalledWith({ isActive: false })
        expect(UnitMaterial.update).not.toHaveBeenCalled()
    })
    it("resolves a group by ID and ignores caller-supplied spelling", async () => {
        expect(await resolveUnitMaterialGroup(4, "Untrusted label")).toEqual({ optionGroupId: 4, optionGroup: "Caja" })
    })
    it("keeps existing inactive associations editable but rejects new assignments", async () => {
        findByPk.mockResolvedValue({ ...group(), isActive: false } as PackagingGroup)
        await expect(resolveUnitMaterialGroup(4, null)).rejects.toMatchObject({ statusCode: 422 })
        expect(await resolveUnitMaterialGroup(4, null, 4)).toEqual({ optionGroupId: 4, optionGroup: "Caja" })
    })
    it("allows fixed rows without a group", async () => {
        expect(await resolveUnitMaterialGroup(null, null)).toEqual({ optionGroupId: null, optionGroup: null })
        expect(findByPk).not.toHaveBeenCalled()
    })
    it("maps legacy names only to an existing catalog entry", async () => {
        findOne.mockResolvedValue(group())
        expect(await resolveUnitMaterialGroup(undefined, "  CAJA  ")).toMatchObject({ optionGroupId: 4 })
        expect(findOne).toHaveBeenCalledWith({ where: { nameKey: "caja" } })
        findOne.mockResolvedValue(null)
        await expect(resolveUnitMaterialGroup(undefined, "Unknown")).rejects.toMatchObject({ statusCode: 422 })
    })
})
