jest.mock("../../features/product/models/ProductVariantPalletMaterial.model", () => ({ __esModule: true, default: { update: jest.fn(), findAll: jest.fn().mockResolvedValue([]) } }))
jest.mock("../../features/packagingGroup/models/PackagingGroup.model", () => ({ __esModule: true, default: { findOrCreate: jest.fn(), sequelize: { transaction: jest.fn() } } }))
jest.mock("../../features/product/models/ProductVariantUnitMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
import Group from "../../features/packagingGroup/models/PackagingGroup.model"
import PalletMaterial from "../../features/product/models/ProductVariantPalletMaterial.model"
import UnitMaterial from "../../features/product/models/ProductVariantUnitMaterial.model"
import { seedPackagingGroups } from "./packagingGroup.seeder"

it("converts legacy case/space variants to stable IDs, preserves defaults and inactive rows, and is idempotent", async () => {
    const updateA = jest.fn(), updateB = jest.fn()
    jest.mocked(UnitMaterial.findAll).mockResolvedValueOnce([
        { id: 1, optionGroup: "  Caja  ", isDefault: true, isActive: true, update: updateA },
        { id: 2, optionGroup: "CAJA", isDefault: false, isActive: false, update: updateB },
    ] as unknown as UnitMaterial[]).mockResolvedValueOnce([])
    const findOrCreate = Group.findOrCreate as unknown as jest.Mock
    findOrCreate.mockResolvedValue([{ id: 4, displayName: "Caja" }, false])
    const transaction = Group.sequelize!.transaction as unknown as jest.Mock
    transaction.mockImplementation(async callback => callback({ LOCK: { UPDATE: "UPDATE" } }))
    await seedPackagingGroups()
    expect(findOrCreate).toHaveBeenCalledTimes(2)
    for (const update of [updateA, updateB]) expect(update).toHaveBeenCalledWith({ optionGroupId: 4, optionGroup: "Caja" }, expect.anything())
    expect(findOrCreate.mock.calls[1][0].where).toEqual({ nameKey: "caja" })
    await seedPackagingGroups()
    expect(findOrCreate).toHaveBeenCalledTimes(2)
})

it("converts pallet groups while preserving explicit box consumption", async () => {
    jest.clearAllMocks()
    jest.mocked(UnitMaterial.findAll).mockResolvedValue([])
    const update = jest.fn()
    jest.mocked(PalletMaterial.findAll).mockResolvedValue([{ id: 3, optionGroup: "Caja", quantityBasis: "per_box", quantityValue: 1, update }] as unknown as PalletMaterial[])
    ;(Group.findOrCreate as unknown as jest.Mock).mockResolvedValue([{ id: 4, displayName: "Caja" }, false])
    ;(Group.sequelize!.transaction as unknown as jest.Mock).mockImplementation(async callback => callback({ LOCK: { UPDATE: "UPDATE" } }))
    await seedPackagingGroups()
    expect(update).toHaveBeenCalledWith({ optionGroupId: 4, optionGroup: "Caja" }, expect.anything())
})
