import "reflect-metadata"
import ExcelJS from "exceljs"
jest.mock("../models/Packaging.model", () => ({ __esModule: true, default: {
    create: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), bulkCreate: jest.fn(), update: jest.fn(),
    sequelize: { transaction: jest.fn(async (work: (transaction: object) => unknown) => work({})), query: jest.fn() },
} }))
jest.mock("../../palletKit/models/PalletKitMaterial.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
import Packaging from "../models/Packaging.model"
import PalletKitMaterial from "../../palletKit/models/PalletKitMaterial.model"
import { packagingService } from "./packaging.service"
import { createPackagingSchema, updatePackagingSchema } from "../schemas/packaging.schema"
import { BulkImportError } from "../../../shared/errors/AppError"
const base = { displayNameEn: "Material", code: "LEG-001", displayName: "Material", packagingRole: "unit" as const, unitCost: 0.1234 }
it.each([ ["CAJA", "per_box", 1], ["TARIMA", "per_pallet", 1], ["ESQUINERO", "per_pallet", 4], ["STRETCH", "per_pallet", 93.3] ] as const)("resolves individual %s consumption on the server for create and edit", async (materialType, basis, quantity) => {
    const input = { ...base, classification: "specific" as const, packagingRole: "pallet" as const, materialType, defaultQuantityBasis: "per_pallet" as const, defaultQuantityValue: 999 }
    await packagingService.createPackaging(input)
    const update = jest.fn()
    jest.mocked(Packaging.findOne).mockResolvedValueOnce({ id: 1, update } as unknown as Packaging).mockResolvedValueOnce(null)
    await packagingService.updatePackaging(1, input)
    for (const mock of [Packaging.create, update]) {
        expect(mock).toHaveBeenCalledWith(expect.objectContaining({ defaultQuantityBasis: basis, defaultQuantityValue: quantity }))
        expect(jest.mocked(mock).mock.calls[0][0]).toHaveProperty("materialType", materialType)
    }
})
it.each([
    ["CAJA", "per_box", 1], ["TARIMA", "per_pallet", 1],
    ["ESQUINERO", "per_pallet", 4], ["STRETCH", "per_pallet", 93.3],
])("assigns fixed consumption for %s without interpreting the material name", async (type, basis, quantity) => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Empaques")
    sheet.addRow(["Código", "Nombre", "Rol del material", "Costo", "Tipo de material"])
    sheet.addRow([base.code, "Nombre sin significado", "pallet", base.unitCost, type])
    await packagingService.bulkImportPackagings(Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(Packaging.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ defaultQuantityBasis: basis, defaultQuantityValue: quantity })])
})
it.each(["", "INTERMEDIO", "INDIVIDUAL"])("rejects missing or incompatible pallet type %s without writes", async type => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Empaques")
    sheet.addRow(["Código", "Nombre", "Rol del material", "Costo", "Tipo de material"])
    sheet.addRow([base.code, "Tarima", "pallet", base.unitCost, type])
    await expect(packagingService.bulkImportPackagings(Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toBeInstanceOf(BulkImportError)
    expect(Packaging.bulkCreate).not.toHaveBeenCalled()
})
beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(Packaging.findOne).mockResolvedValue(null)
    jest.mocked(Packaging.findAll).mockResolvedValue([])
    jest.mocked(Packaging.create).mockImplementation(async input => input as unknown as Packaging)
    jest.mocked(Packaging.bulkCreate).mockImplementation(async input => input as unknown as Packaging[])
})
it("creates and edits specific materials with their own code and decimal cost", async () => {
    const input = createPackagingSchema.parse({ ...base, classification: "specific" })
    expect(await packagingService.createPackaging(input)).toMatchObject({ ...input, materialType: "INDIVIDUAL" })
    const update = jest.fn(async values => values)
    jest.mocked(Packaging.findOne).mockResolvedValueOnce({ ...input, id: 1, update } as unknown as Packaging).mockResolvedValueOnce(null)
    await packagingService.updatePackaging(1, updatePackagingSchema.parse({ ...input, isActive: false }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ classification: "specific", code: base.code, unitCost: 0.1234, isActive: false }))
})
it("generic materials never take a user code: the system assigns GEN-IND/INT/PAL-NNNN per level", async () => {
    const { code: _code, ...withoutCode } = base
    expect(createPackagingSchema.safeParse({ ...base, classification: "generic" }).error?.issues[0].message).toBe("errors.packaging_generic_code_forbidden")
    expect(createPackagingSchema.safeParse({ ...withoutCode, classification: "specific" }).error?.issues[0].message).toBe("errors.packaging_code_required")
    jest.mocked(Packaging.findAll).mockResolvedValueOnce([{ code: "GEN-PAL-0007" }, { code: "GEN-PAL-0002" }, { code: "GEN-PAL-OLD" }] as Packaging[])
    const created = await packagingService.createPackaging(createPackagingSchema.parse({ ...withoutCode, classification: "generic", packagingRole: "pallet", materialType: "TARIMA" }))
    expect(created).toMatchObject({ code: "GEN-PAL-0008", classification: "generic", defaultQuantityValue: 1 })
    expect((await packagingService.createPackaging(createPackagingSchema.parse({ ...withoutCode, classification: "generic" }))).code).toBe("GEN-IND-0001")
})
it("editing a generic keeps its code, rejects a different one and renews it when the level changes", async () => {
    const generic = { ...base, code: "GEN-IND-0003", classification: "generic" as const }
    const update = jest.fn(async values => values)
    jest.mocked(Packaging.findOne).mockResolvedValue({ ...generic, id: 1, update } as unknown as Packaging)
    await packagingService.updatePackaging(1, { displayName: "Nuevo", packagingRole: "unit", unitCost: 1 })
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ code: "GEN-IND-0003", displayName: "Nuevo" }))
    await expect(packagingService.updatePackaging(1, { code: "MIO-1", packagingRole: "unit", unitCost: 1 })).rejects.toMatchObject({ key: "errors.packaging_generic_code_forbidden" })
    await packagingService.updatePackaging(1, { packagingRole: "intermediate", unitCost: 1 })
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ code: "GEN-INT-0001", packagingRole: "intermediate" }), { transaction: {} })
    await expect(packagingService.updatePackaging(1, { classification: "specific", packagingRole: "unit", unitCost: 1 })).rejects.toMatchObject({ key: "errors.packaging_code_required" })
})
it.each([-1, Infinity, NaN, 1000000, 0.1234567890123])("rejects invalid or unrepresentable costs %s", unitCost => {
    expect(createPackagingSchema.safeParse({ ...base, classification: "generic", unitCost }).success).toBe(false)
})
it.each([0, 0.1234, 0.12345, 0.123456789012, 0.000000000001, 999999.9999])("preserves up to twelve cost decimals on create and update: %s", async unitCost => {
    const input = createPackagingSchema.parse({ ...base, classification: "specific", unitCost })
    expect((await packagingService.createPackaging(input)).unitCost).toBe(unitCost)
    expect(Packaging.create).toHaveBeenCalledWith(expect.objectContaining({ unitCost }))
    const update = jest.fn(async values => values)
    jest.mocked(Packaging.findOne).mockResolvedValueOnce({ ...input, id: 1, update } as unknown as Packaging).mockResolvedValueOnce(null)
    await packagingService.updatePackaging(1, updatePackagingSchema.parse({ ...input, unitCost }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ unitCost }))
})
it("requires explicit classification on new API input and retains compatibility on edits", () => {
    expect(createPackagingSchema.safeParse(base).success).toBe(false)
    expect(updatePackagingSchema.safeParse(base).success).toBe(true)
})
it("requires both names on creation and allows a historical English name to remain NULL", async () => {
    expect(createPackagingSchema.safeParse({ ...base, classification: "specific", displayNameEn: " " }).success).toBe(false)
    expect(createPackagingSchema.safeParse({ ...base, classification: "specific", displayNameEn: null }).success).toBe(false)
    const update = jest.fn()
    jest.mocked(Packaging.findOne).mockResolvedValueOnce({ ...base, id: 1, update } as unknown as Packaging).mockResolvedValueOnce(null)
    await packagingService.updatePackaging(1, { ...base, displayNameEn: " " })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ displayName: base.displayName, displayNameEn: null }))
})
it.each(["Bag", "", null, 123])("imports the new English column without inventing names: %s", async displayNameEn => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Empaques")
    sheet.addRow(["Código", "Nombre (Español)", "Nombre (Inglés)", "Rol", "Costo"])
    sheet.addRow([base.code, "Nombre original", displayNameEn, "unit", 0.1234])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    if (displayNameEn === "Bag") {
        await packagingService.bulkImportPackagings(buffer)
        expect(Packaging.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ displayName: "Nombre original", displayNameEn: "Bag", classification: "specific" })])
    } else {
        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(Packaging.bulkCreate).not.toHaveBeenCalled()
    }
})
it("preserves code uniqueness for specific materials", async () => {
    jest.mocked(Packaging.findOne).mockResolvedValue({ id: 1 } as Packaging)
    await expect(packagingService.createPackaging({ ...base, classification: "specific" })).rejects.toMatchObject({ statusCode: 409 })
    expect(Packaging.create).not.toHaveBeenCalled()
})
it("rejects generic materials in fixed-product association validation", async () => {
    jest.mocked(Packaging.findOne).mockResolvedValue({ ...base, id: 1, isActive: true, classification: "generic" } as Packaging)
    await expect(packagingService.assertPackagingHasRole(1, "unit")).rejects.toMatchObject({ key: "errors.packaging_generic_not_available" })
})
it("preserves twelve-decimal packaging costs imported from Excel", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Empaques")
    sheet.addRow(["Código", "Nombre", "Rol del material", "Costo"])
    sheet.addRow([base.code, base.displayName, base.packagingRole, 0.123456789012])
    await packagingService.bulkImportPackagings(Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(Packaging.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ unitCost: 0.123456789012 })])
})
it.each([undefined, "", "specific", "Específico", "Específico de cliente", "especifico de cliente", "generic", "Genérico", "invalid"])("imports classification %s with conservative legacy fallback", async classification => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Empaques")
    sheet.addRow(["Código", "Nombre", "Rol del material", "Costo", ...(classification === undefined ? [] : ["Clasificación"])])
    const generic = classification === "generic" || classification === "Genérico"
    sheet.addRow([generic ? "" : base.code, base.displayName, base.packagingRole, base.unitCost, ...(classification === undefined ? [] : [classification])])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    if (classification === "invalid") {
        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(Packaging.bulkCreate).not.toHaveBeenCalled()
    } else {
        await packagingService.bulkImportPackagings(buffer)
        expect(jest.mocked(Packaging.bulkCreate).mock.calls[0][0]).toEqual([expect.objectContaining({ ...base, code: generic ? "GEN-IND-0001" : base.code, displayNameEn: null, classification: generic ? "generic" : "specific" })])
    }
})

it("bulk import: specific rows need their code, generic rows must leave it empty and get consecutive codes", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Empaques")
    sheet.addRow(["Clasificación", "Código", "Nombre", "Rol del material", "Costo"])
    sheet.addRow(["Específico", "", "Sin código", "unit", 1])
    sheet.addRow(["Genérico", "MIO-1", "Con código", "unit", 1])
    const rejected = await packagingService.bulkImportPackagings(Buffer.from(await workbook.xlsx.writeBuffer())).catch(error => error)
    expect(rejected).toBeInstanceOf(BulkImportError)
    expect(rejected.rowIssues).toEqual([expect.objectContaining({ row: 2, field: "code", key: "errors.packaging_code_required" }), expect.objectContaining({ row: 3, field: "code", key: "errors.packaging_generic_code_forbidden" })])
    const valid = new ExcelJS.Workbook(), rows = valid.addWorksheet("Empaques")
    rows.addRow(["Clasificación", "Código", "Nombre", "Rol del material", "Costo"])
    rows.addRow(["Genérico", "", "Bolsa A", "unit", 1]); rows.addRow(["Específico", "CLI-1", "Bolsa cliente", "unit", 1]); rows.addRow(["Genérico", "", "Bolsa B", "unit", 1])
    jest.mocked(Packaging.findAll).mockResolvedValueOnce([]).mockResolvedValueOnce([{ code: "GEN-IND-0041" }] as Packaging[])
    await packagingService.bulkImportPackagings(Buffer.from(await valid.xlsx.writeBuffer()))
    expect(jest.mocked(Packaging.bulkCreate).mock.calls[0][0].map(row => row.code)).toEqual(["GEN-IND-0042", "CLI-1", "GEN-IND-0043"])
})

it("stores the material type: the level's for unit/intermediate, the chosen one for pallet with its fixed consumption", async () => {
    const { code: _code, ...withoutCode } = base
    expect(await packagingService.createPackaging(createPackagingSchema.parse({ ...base, classification: "specific" }))).toMatchObject({ materialType: "INDIVIDUAL", defaultQuantityBasis: null })
    expect(await packagingService.createPackaging(createPackagingSchema.parse({ ...withoutCode, classification: "generic", packagingRole: "pallet", materialType: "STRETCH" }))).toMatchObject({ materialType: "STRETCH", defaultQuantityBasis: "per_pallet", defaultQuantityValue: 93.3 })
    expect(await packagingService.createPackaging(createPackagingSchema.parse({ ...base, classification: "specific", packagingRole: "pallet", materialType: "OTRO" }))).toMatchObject({ materialType: "OTRO" })
    await expect(packagingService.createPackaging(createPackagingSchema.parse({ ...base, classification: "specific", packagingRole: "pallet" }))).rejects.toMatchObject({ key: "errors.packaging_import_material_type" })
})
it("a material in the pallet kit cannot be deactivated or reshaped until it is removed from the kit", async () => {
    const update = jest.fn(async values => values)
    const kitMaterial = { ...base, code: "GEN-PAL-0004", classification: "generic", packagingRole: "pallet", materialType: "ESQUINERO", id: 4, update }
    // Code uniqueness lookups find nobody; the id lookup returns the kit material.
    jest.mocked(Packaging.findOne).mockImplementation((async ({ where }: { where: Record<string, unknown> }) => "code" in where ? null : kitMaterial) as never)
    jest.mocked(PalletKitMaterial.findOne).mockResolvedValue({ packagingId: 4 } as PalletKitMaterial)
    await packagingService.updatePackaging(4, { packagingRole: "pallet", unitCost: 2 })
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ unitCost: 2, materialType: "ESQUINERO" }))
    for (const change of [{ materialType: "TARIMA" as const }, { classification: "specific" as const, code: "X-1" }, { isActive: false }])
        await expect(packagingService.updatePackaging(4, { packagingRole: "pallet", unitCost: 2, ...change })).rejects.toMatchObject({ key: "errors.packaging_in_pallet_kit" })
    await expect(packagingService.deletePackaging(4)).rejects.toMatchObject({ key: "errors.packaging_in_pallet_kit" })
    jest.mocked(PalletKitMaterial.findOne).mockResolvedValue(null)
    await packagingService.deletePackaging(4)
    expect(update).toHaveBeenLastCalledWith({ isActive: false })
})
