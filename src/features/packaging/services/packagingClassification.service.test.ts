import "reflect-metadata"
import ExcelJS from "exceljs"
jest.mock("../models/Packaging.model", () => ({ __esModule: true, default: {
    create: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), bulkCreate: jest.fn(),
} }))
import Packaging from "../models/Packaging.model"
import { packagingService } from "./packaging.service"
import { createPackagingSchema, updatePackagingSchema } from "../schemas/packaging.schema"
import { BulkImportError } from "../../../shared/errors/AppError"
const base = { displayNameEn: "Material", code: "LEG-001", displayName: "Material", packagingRole: "unit" as const, unitCost: 0.1234 }
beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(Packaging.findOne).mockResolvedValue(null)
    jest.mocked(Packaging.findAll).mockResolvedValue([])
    jest.mocked(Packaging.create).mockImplementation(async input => input as unknown as Packaging)
    jest.mocked(Packaging.bulkCreate).mockImplementation(async input => input as unknown as Packaging[])
})
it.each(["specific", "generic"] as const)("creates and edits %s with unchanged internal code and decimal cost", async classification => {
    const input = createPackagingSchema.parse({ ...base, classification })
    expect(await packagingService.createPackaging(input)).toEqual(input)
    const update = jest.fn(async values => values)
    jest.mocked(Packaging.findOne).mockResolvedValueOnce({ ...input, id: 1, update } as unknown as Packaging).mockResolvedValueOnce(null)
    await packagingService.updatePackaging(1, updatePackagingSchema.parse({ ...input, isActive: false }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ classification, code: base.code, unitCost: 0.1234, isActive: false }))
})
it.each([-1, Infinity, NaN, 1000000, 0.12345])("rejects invalid or unrepresentable costs %s", unitCost => {
    expect(createPackagingSchema.safeParse({ ...base, classification: "generic", unitCost }).success).toBe(false)
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
it("preserves existing code uniqueness for generic materials", async () => {
    jest.mocked(Packaging.findOne).mockResolvedValue({ id: 1 } as Packaging)
    await expect(packagingService.createPackaging({ ...base, classification: "generic" })).rejects.toMatchObject({ statusCode: 409 })
    expect(Packaging.create).not.toHaveBeenCalled()
})
it("rejects generic materials in fixed-product association validation", async () => {
    jest.mocked(Packaging.findOne).mockResolvedValue({ ...base, id: 1, isActive: true, classification: "generic" } as Packaging)
    await expect(packagingService.assertPackagingHasRole(1, "unit")).rejects.toMatchObject({ key: "errors.packaging_generic_not_available" })
})
it.each([undefined, "", "specific", "Específico", "generic", "Genérico", "invalid"])("imports classification %s with conservative legacy fallback", async classification => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Empaques")
    sheet.addRow(["Código", "Nombre", "Rol del material", "Costo", ...(classification === undefined ? [] : ["Clasificación"])])
    sheet.addRow([base.code, base.displayName, base.packagingRole, base.unitCost, ...(classification === undefined ? [] : [classification])])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    if (classification === "invalid") {
        await expect(packagingService.bulkImportPackagings(buffer)).rejects.toBeInstanceOf(BulkImportError)
        expect(Packaging.bulkCreate).not.toHaveBeenCalled()
    } else {
        await packagingService.bulkImportPackagings(buffer)
        expect(Packaging.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ ...base, displayNameEn: null, classification: classification === "generic" || classification === "Genérico" ? "generic" : "specific" })])
    }
})
