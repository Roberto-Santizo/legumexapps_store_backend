import "reflect-metadata"
jest.mock("../models/PalletKitMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), destroy: jest.fn() } }))
jest.mock("../../packaging/models/Packaging.model", () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn() } }))
import PalletKitMaterial from "../models/PalletKitMaterial.model"
import Packaging from "../../packaging/models/Packaging.model"
import { loadPalletKit, palletKitService } from "./palletKit.service"

const material = (id: number, materialType: string, overrides: Record<string, unknown> = {}) => ({ id, displayName: `M${id}`, isActive: true, classification: "generic", packagingRole: "pallet", materialType,
    unitCost: "1", defaultQuantityBasis: "per_pallet", defaultQuantityValue: materialType === "ESQUINERO" ? "4.00" : materialType === "STRETCH" ? "93.30" : "1.00", ...overrides })
const kitRows = (...materials: object[]) => materials.map(packaging => ({ packaging }))
beforeEach(() => jest.clearAllMocks())

it("loads the kit by type with several materials per type and ignores unusable ones", async () => {
    jest.mocked(PalletKitMaterial.findAll).mockResolvedValue(kitRows(material(1, "TARIMA"), material(2, "ESQUINERO"), material(3, "ESQUINERO"), material(4, "STRETCH", { isActive: false }), material(5, "CAJA")) as never)
    const kit = await loadPalletKit()
    expect(kit.map(part => [part.type, part.options.map(option => option.id)])).toEqual([["TARIMA", [1]], ["ESQUINERO", [2, 3]], ["STRETCH", []]])
    expect((await palletKitService.getKit()).complete).toBe(false)
})
it("adds only generic active pallet materials of a kit type with cost, once", async () => {
    jest.mocked(PalletKitMaterial.findAll).mockResolvedValue([] as never)
    for (const invalid of [material(9, "CAJA"), material(9, "TARIMA", { classification: "specific" }), material(9, "TARIMA", { isActive: false }), material(9, "TARIMA", { unitCost: null }), null]) {
        jest.mocked(Packaging.findByPk).mockResolvedValueOnce(invalid as never)
        await expect(palletKitService.addMaterial(9)).rejects.toMatchObject({ statusCode: 422, key: "errors.pallet_kit_material_invalid" })
    }
    jest.mocked(Packaging.findByPk).mockResolvedValue(material(9, "ESQUINERO") as never)
    jest.mocked(PalletKitMaterial.findOne).mockResolvedValueOnce({ packagingId: 9 } as never)
    await expect(palletKitService.addMaterial(9)).rejects.toMatchObject({ statusCode: 409, key: "errors.pallet_kit_material_duplicate" })
    jest.mocked(PalletKitMaterial.findOne).mockResolvedValueOnce(null)
    await palletKitService.addMaterial(9)
    expect(PalletKitMaterial.create).toHaveBeenCalledWith({ packagingId: 9 })
})
it("removing deletes the assignment; candidates exclude materials already in the kit", async () => {
    jest.mocked(PalletKitMaterial.findAll).mockResolvedValue([] as never)
    jest.mocked(PalletKitMaterial.destroy).mockResolvedValueOnce(0)
    await expect(palletKitService.removeMaterial(9)).rejects.toMatchObject({ statusCode: 404 })
    jest.mocked(PalletKitMaterial.destroy).mockResolvedValueOnce(1)
    await palletKitService.removeMaterial(9)
    expect(PalletKitMaterial.destroy).toHaveBeenLastCalledWith({ where: { packagingId: 9 } })
    jest.mocked(PalletKitMaterial.findAll).mockResolvedValue([{ packagingId: 1 }] as never)
    jest.mocked(Packaging.findAll).mockResolvedValue([material(1, "TARIMA"), material(2, "TARIMA"), material(3, "STRETCH", { unitCost: null })] as never)
    expect((await palletKitService.listCandidates()).map(row => row.id)).toEqual([2])
})
