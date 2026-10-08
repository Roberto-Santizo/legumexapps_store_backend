import ExcelJS from "exceljs"
import { Transaction } from "sequelize"
jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn() } }))
jest.mock("../models/ProductVariant.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/Product.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../packaging/models/Packaging.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../packagingGroup/models/PackagingGroup.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/ProductVariantUnitMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/ProductVariantIntermediateMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/ProductVariantPalletMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))

import sequelize from "../../../database/connection"
import ProductVariant from "../models/ProductVariant.model"
import Product from "../models/Product.model"
import Packaging from "../../packaging/models/Packaging.model"
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model"
import UnitMaterial from "../models/ProductVariantUnitMaterial.model"
import IntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import PalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { productPackagingImportService as service } from "./productPackagingImport.service"
import { PRODUCT_PACKAGING_IMPORT_COLUMNS as columns } from "../constants/productPackagingImport.constant"
import { loadWorkbookFromBuffer, writeWorkbookToBuffer } from "../../../shared/utils/excelImport.util"
import { prefixSpreadsheetNamespaces } from "../../../shared/test-utils/xlsxCompatibility.fixture"
import { BulkImportError } from "../../../shared/errors/AppError"

const mock = (value: unknown) => value as jest.Mock
type InputRow = Partial<Record<keyof typeof columns, ExcelJS.CellValue>>
const unit: InputRow = { skuCode: "PTC123", packagingCode: "MP-U" }
const box: InputRow = { skuCode: "PTC123", packagingCode: "MP-B", group: "Renamed box group", isDefault: "SI", quantityBasis: "per_box", quantity: 1 }
const corner: InputRow = { skuCode: "PTC123", packagingCode: "MP-C", group: "Renamed corner group", isDefault: "TRUE", quantityBasis: "per_pallet", quantity: 4 }
let variants: Record<string, unknown>[]
let products: Record<string, unknown>[]
let packagings: Record<string, unknown>[]
let groups: Record<string, unknown>[]
let existing: Record<string, unknown>[]
const transaction = { LOCK: { UPDATE: "UPDATE" }, staged: [] as unknown[], rollback: jest.fn(), commit: jest.fn() }

async function excel(rows: InputRow[], fields = Object.keys(columns) as (keyof typeof columns)[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Import")
    sheet.addRow(fields.map(field => columns[field].header))
    rows.forEach(row => sheet.addRow(fields.map(field => row[field] ?? null)))
    return writeWorkbookToBuffer(workbook)
}
function noWrites() {
    expect(UnitMaterial.create).not.toHaveBeenCalled()
    expect(IntermediateMaterial.create).not.toHaveBeenCalled()
    expect(PalletMaterial.create).not.toHaveBeenCalled()
}
async function expectIssue(row: InputRow, key: string) {
    const result = await service.previewProductPackagingImport(await excel([row]))
    expect(result.rows[0].action).toBe("error")
    expect(result.rows[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ row: 2, key: `errors.packaging_association_import.${key}` })]))
    expect(sequelize.transaction).not.toHaveBeenCalled()
    noWrites()
}

beforeEach(() => {
    jest.resetAllMocks()
    transaction.staged = []
    variants = [{ id: 10, skuCode: "PTC123", productId: 1, isActive: true, boxesPerPallet: 40, bagsPerBox: 12, unitsPerIntermediatePackage: 6 }]
    products = [{ id: 1, isActive: true }]
    packagings = [
        { id: 20, code: "MP-U", displayName: "Unit", packagingRole: "unit", isActive: true, unitCost: 0.6 },
        { id: 21, code: "MP-B", displayName: "Unclassified A", packagingRole: "pallet", isActive: true, unitCost: 1 },
        { id: 22, code: "MP-C", displayName: "Unclassified B", packagingRole: "pallet", isActive: true, unitCost: 2 },
        { id: 23, code: "MP-T", displayName: "Unclassified C", packagingRole: "pallet", isActive: true, unitCost: 10 },
        { id: 24, code: "MP-S", displayName: "Unclassified D", packagingRole: "pallet", isActive: true, unitCost: 0.1 },
        { id: 25, code: "MP-I", displayName: "Intermediate", packagingRole: "intermediate", isActive: true, unitCost: 0.2 },
        { id: 26, code: "MP-B2", displayName: "Other box", packagingRole: "pallet", isActive: true, unitCost: 3 },
    ]
    groups = [{ id: 4, displayName: "Renamed box group", nameKey: "renamed box group", isActive: true }, { id: 5, displayName: "Renamed corner group", nameKey: "renamed corner group", isActive: true }]
    existing = []
    mock(ProductVariant.findAll).mockImplementation(async () => variants)
    mock(Product.findAll).mockImplementation(async () => products)
    mock(Packaging.findAll).mockImplementation(async () => packagings)
    mock(PackagingGroup.findAll).mockImplementation(async () => groups)
    mock(UnitMaterial.findAll).mockResolvedValue([])
    mock(IntermediateMaterial.findAll).mockResolvedValue([])
    mock(PalletMaterial.findAll).mockImplementation(async () => existing)
    mock(sequelize.transaction).mockImplementation(async (_options, callback) => {
        try { const result = await callback(transaction); transaction.commit(); return result }
        catch (error) { transaction.staged = []; transaction.rollback(); throw error }
    })
    for (const model of [UnitMaterial, IntermediateMaterial, PalletMaterial]) mock(model.create).mockImplementation(async (values, options) => { options.transaction.staged.push(values); return values })
})

describe("Excel associations: preview and confirmation", () => {
    it("fallback preserves packaging consumption quantities in preview", async () => {
        const buffer = await prefixSpreadsheetNamespaces(await excel([unit, box, corner,
            { ...unit, packagingCode: "MP-T", quantityBasis: "per_pallet", quantity: 1 },
            { ...unit, packagingCode: "MP-S", quantityBasis: "per_pallet", quantity: 93.3 }]))
        const preview = await service.previewProductPackagingImport(buffer)
        expect(preview.rows.map(row => [row.quantityBasis, row.quantity])).toEqual([["per_unit", 1], ["per_box", 1], ["per_pallet", 4], ["per_pallet", 1], ["per_pallet", 93.3]])
        expect(preview.summary.error).toBe(0)
        noWrites()
    })
    it("imports all five explicit consumption rules without changing the masters", async () => {
        const buffer = await excel([unit, box, corner,
            { ...unit, packagingCode: "MP-T", quantityBasis: "per_pallet", quantity: 1 },
            { ...unit, packagingCode: "MP-S", quantityBasis: "per_pallet", quantity: 93.3 }])
        const preview = await service.previewProductPackagingImport(buffer)
        expect(preview.summary).toEqual({ total: 5, new: 5, update: 0, unchanged: 0, error: 0 })
        expect(preview.rows.map(row => [row.quantityBasis, row.quantity])).toEqual([["per_unit", 1], ["per_box", 1], ["per_pallet", 4], ["per_pallet", 1], ["per_pallet", 93.3]])
        noWrites()
        expect(await service.confirmProductPackagingImport(buffer, preview.previewHash)).toEqual(preview.summary)
        expect(sequelize.transaction).toHaveBeenCalledWith({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, expect.any(Function))
        expect(UnitMaterial.create).toHaveBeenCalledWith(expect.objectContaining({ productVariantId: 10, packagingId: 20, quantityPerUnit: 1 }), { transaction })
        expect(PalletMaterial.create).toHaveBeenCalledWith(expect.objectContaining({ packagingId: 21, optionGroupId: 4, quantityBasis: "per_box", quantityValue: 1 }), { transaction })
        expect(transaction.staged).toHaveLength(5)
    })
    it("rejects missing headers and aliases that duplicate the same column", async () => {
        await expect(service.previewProductPackagingImport(await excel([unit], ["skuCode"]))).rejects.toMatchObject({ key: "errors.bulk_import_missing_columns" })
        const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Import")
        sheet.addRow(["CÓDIGO SKU", "sku code", "CÓDIGO MP"]); sheet.addRow(["PTC123", "PTC123", "MP-U"])
        await expect(service.previewProductPackagingImport(await writeWorkbookToBuffer(workbook))).rejects.toMatchObject({ key: "errors.packaging_association_import.duplicate_header" })
        noWrites()
    })
    it("reports missing SKU even if names match", async () => { variants = []; await expectIssue(unit, "unknown_sku") })
    it("reports missing Packaging and never creates it from the Excel name", async () => { packagings = []; await expectIssue({ ...unit, materialName: "Unit" }, "unknown_packaging") })
    it("reports inactive variant", async () => { variants[0].isActive = false; await expectIssue(unit, "inactive_variant") })
    it("reports inactive product", async () => { products[0].isActive = false; await expectIssue(unit, "inactive_product") })
    it("reports inactive Packaging", async () => { packagings[0].isActive = false; await expectIssue(unit, "inactive_packaging") })
    it("rejects ambiguous material codes differing only by case", async () => {
        packagings.push({ ...packagings[0], id: 99, code: "mp-u" })
        await expectIssue(unit, "ambiguous_packaging")
    })
    it("rejects a material that still has an active association at a different level", async () => {
        mock(UnitMaterial.findAll).mockResolvedValue([{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: null, optionGroup: null, isDefault: false, isActive: true, quantityPerUnit: 1 }])
        await expectIssue(box, "existing_role")
    })
    it("reports unknown option group", async () => { await expectIssue({ ...box, group: "Missing" }, "unknown_group") })
    it("reports inactive option group", async () => { groups[0].isActive = false; await expectIssue(box, "inactive_group") })
    it("reports per_box without boxesPerPallet", async () => { variants[0].boxesPerPallet = null; await expectIssue(box, "boxes_required") })
    it("requires explicit pallet quantity instead of deriving it from names", async () => { packagings[1].displayName = "CAJA"; await expectIssue({ ...box, quantity: null }, "pallet_quantity") })
    it.each([0, -1, "bad", "0x10", 1.001, Infinity])("rejects invalid quantity %s", async quantity => {
        const result = await service.previewProductPackagingImport(await excel([{ ...box, quantity }]))
        expect(result.summary.error).toBe(1); noWrites()
    })
    it("rejects unit quantity other than one", async () => { await expectIssue({ ...unit, quantity: 2 }, "unit_rule") })
    it.each(["x", "maybe", "2"])("rejects ambiguous default %s", async isDefault => { await expectIssue({ ...box, isDefault }, "boolean") })
    it("requires an intermediate configuration from the variant", async () => { variants[0].unitsPerIntermediatePackage = null; await expectIssue({ ...unit, packagingCode: "MP-I" }, "intermediate_configuration") })
    it("imports intermediate without an invented association quantity", async () => {
        const buffer = await excel([{ ...unit, packagingCode: "MP-I" }])
        const result = await service.previewProductPackagingImport(buffer)
        expect(result.summary.error).toBe(0); expect(result.rows[0].quantity).toBeNull()
        await service.confirmProductPackagingImport(buffer, result.previewHash)
        expect(IntermediateMaterial.create).toHaveBeenCalledWith({ productVariantId: 10, packagingId: 25, optionGroup: null, isDefault: false, isActive: true }, { transaction })
    })
    it("rejects a quantity entered for intermediate", async () => { await expectIssue({ ...unit, packagingCode: "MP-I", quantity: 1 }, "intermediate_rule") })
    it("reports both duplicate SKU/material rows including case/space variants", async () => {
        const result = await service.previewProductPackagingImport(await excel([unit, { ...unit, skuCode: " ptc123 ", packagingCode: "mp-u" }]))
        expect(result.summary.error).toBe(2)
        expect(result.rows.map(row => row.issues.some(issue => issue.key.endsWith(".duplicate")))).toEqual([true, true])
    })
    it("reports multiple defaults on all involved rows", async () => {
        const result = await service.previewProductPackagingImport(await excel([box, { ...box, packagingCode: "MP-B2" }]))
        expect(result.summary.error).toBe(2)
        expect(result.rows.every(row => row.issues.some(issue => issue.key.endsWith(".defaults")))).toBe(true)
    })
    it("reports no default in a new group", async () => { await expectIssue({ ...box, isDefault: "NO" }, "defaults") })
    it("allows a nondefault alternative when an existing sibling is default", async () => {
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: 4, optionGroup: "Renamed box group", quantityBasis: "per_box", quantityValue: "1.00", isDefault: true, isActive: true }]
        const preview = await service.previewProductPackagingImport(await excel([{ ...box, packagingCode: "MP-B2", isDefault: "NO" }]))
        expect(preview.summary.error).toBe(0)
    })
    it("rejects incompatible quantities against untouched existing siblings", async () => {
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: 4, optionGroup: "Renamed box group", quantityBasis: "per_box", quantityValue: 1, isDefault: true, isActive: true }]
        await expectIssue({ ...box, packagingCode: "MP-B2", isDefault: "NO", quantityBasis: "per_pallet", quantity: 4 }, "group_quantity")
    })
    it("shows an update and writes the existing association with the transaction", async () => {
        const update = jest.fn()
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: null, optionGroup: null, quantityBasis: "per_pallet", quantityValue: 40, isDefault: false, isActive: true, update }]
        const buffer = await excel([box]); const result = await service.previewProductPackagingImport(buffer)
        expect(result.rows[0]).toMatchObject({ action: "update", previous: { quantityBasis: "per_pallet", quantityValue: 40 } })
        await service.confirmProductPackagingImport(buffer, result.previewHash)
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ quantityBasis: "per_box", quantityValue: 1, optionGroupId: 4 }), { transaction })
        noWrites()
    })
    it("does not silently demote an untouched default", async () => {
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: 4, optionGroup: "Renamed box group", quantityBasis: "per_box", quantityValue: 1, isDefault: true, isActive: true }]
        await expectIssue({ ...box, packagingCode: "MP-B2" }, "defaults")
    })
    it("permits an explicit default swap by importing both rows", async () => {
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: 4, optionGroup: "Renamed box group", quantityBasis: "per_box", quantityValue: 1, isDefault: true, isActive: true, update: jest.fn() }]
        const buffer = await excel([{ ...box, isDefault: "NO" }, { ...box, packagingCode: "MP-B2" }])
        const result = await service.previewProductPackagingImport(buffer)
        expect(result.summary).toMatchObject({ error: 0, update: 1, new: 1 })
        await service.confirmProductPackagingImport(buffer, result.previewHash)
        expect(existing[0].update).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }), { transaction })
    })
    it("blocks removing the default from a group with untouched alternatives", async () => {
        existing = [
            { id: 100, productVariantId: 10, packagingId: 21, optionGroupId: 4, optionGroup: "Renamed box group", quantityBasis: "per_box", quantityValue: 1, isDefault: true, isActive: true },
            { id: 101, productVariantId: 10, packagingId: 26, optionGroupId: 4, optionGroup: "Renamed box group", quantityBasis: "per_box", quantityValue: 1, isDefault: false, isActive: true },
        ]
        await expectIssue({ ...box, group: null, isDefault: "NO" }, "defaults")
    })
    it("skips unchanged rows, including decimal strings from PostgreSQL", async () => {
        const update = jest.fn()
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: 4, optionGroup: "Renamed box group", quantityBasis: "per_box", quantityValue: "1.00", isDefault: true, isActive: true, update }]
        const buffer = await excel([box]); const result = await service.previewProductPackagingImport(buffer)
        expect(result.summary.unchanged).toBe(1)
        await service.confirmProductPackagingImport(buffer, result.previewHash)
        noWrites(); expect(update).not.toHaveBeenCalled()
    })
    it("shows reactivation as an update rather than violating the unique index", async () => {
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: 4, optionGroup: "Renamed box group", quantityBasis: "per_box", quantityValue: 1, isDefault: true, isActive: false, update: jest.fn() }]
        const result = await service.previewProductPackagingImport(await excel([box]))
        expect(result.rows[0]).toMatchObject({ action: "update", previous: { isActive: false } })
    })
    it("warns on name/cost differences and preserves the master catalog", async () => {
        const buffer = await excel([{ ...unit, materialName: "Wrong name", unitCost: 0.62 }])
        const result = await service.previewProductPackagingImport(buffer)
        expect(result.rows[0].warnings).toHaveLength(2)
        expect(result.rows[0].unitCost).toBe(0.6)
        await service.confirmProductPackagingImport(buffer, result.previewHash)
        expect(packagings[0].unitCost).toBe(0.6)
    })
    it("accepts legacy additional informational columns but blocks incomplete pallet rows", async () => {
        const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Legacy")
        sheet.addRow(["CÓDIGO MP", "NOMBRE MP", "CÓDIGO SKU", "NOMBRE SKU", "PRESENTACIÓN PM", "CLIENTE REF PM", "NOMBRE EMPAQUE PM", "MATERIAL PM", "COSTO POR UNIDAD (USD)"])
        sheet.addRow(["MP-U", "Unit", "PTC123", "Anything", "Anything", "Anything", "Anything", "Anything", 0.62])
        sheet.addRow(["MP-B", "Box", "PTC123"])
        const result = await service.previewProductPackagingImport(await writeWorkbookToBuffer(workbook))
        expect(result.rows[0].action).toBe("new")
        expect(result.rows[1].action).toBe("error")
        expect(result.rows[1].issues.some(issue => issue.key.endsWith(".missing_consumption"))).toBe(true)
    })
    it("does not write any valid rows when one row is invalid at confirmation", async () => {
        const buffer = await excel([unit, { ...box, quantity: 0 }]); const result = await service.previewProductPackagingImport(buffer)
        await expect(service.confirmProductPackagingImport(buffer, result.previewHash)).rejects.toBeInstanceOf(BulkImportError)
        noWrites(); expect(transaction.rollback).toHaveBeenCalled()
    })
    it("rolls back the entire transaction if a later write fails", async () => {
        const buffer = await excel([unit, box]); const result = await service.previewProductPackagingImport(buffer)
        mock(PalletMaterial.create).mockRejectedValue(new Error("write failed"))
        await expect(service.confirmProductPackagingImport(buffer, result.previewHash)).rejects.toThrow("write failed")
        expect(UnitMaterial.create).toHaveBeenCalledWith(expect.any(Object), { transaction })
        expect(transaction.rollback).toHaveBeenCalled(); expect(transaction.commit).not.toHaveBeenCalled()
        expect(transaction.staged).toHaveLength(0)
    })
    it("rejects a stale preview after catalog cost changes", async () => {
        const buffer = await excel([unit]); const result = await service.previewProductPackagingImport(buffer)
        packagings[0].unitCost = 0.8
        await expect(service.confirmProductPackagingImport(buffer, result.previewHash)).rejects.toMatchObject({ statusCode: 409, key: "errors.packaging_association_import.stale_preview" })
        noWrites()
    })
    it("requires a preview hash and binds it to file contents", async () => {
        const buffer = await excel([unit]); const result = await service.previewProductPackagingImport(buffer)
        await expect(service.confirmProductPackagingImport(buffer, "")).rejects.toMatchObject({ key: "errors.packaging_association_import.preview_required" })
        await expect(service.confirmProductPackagingImport(await excel([box]), result.previewHash)).rejects.toMatchObject({ statusCode: 409 })
        noWrites()
    })
    it("rejects cached formulas instead of trusting their values", async () => { await expectIssue({ ...unit, skuCode: { formula: '"PTC123"', result: "PTC123" } }, "formula") })
    it("does not skip an otherwise blank row containing an uncached formula", async () => {
        const result = await service.previewProductPackagingImport(await excel([{ skuCode: { formula: '"PTC123"' } }]))
        expect(result.summary.error).toBe(1)
        expect(result.rows[0].issues.some(issue => issue.key.endsWith(".formula"))).toBe(true)
    })
    it("ignores blank rows without losing Excel row numbers", async () => {
        const result = await service.previewProductPackagingImport(await excel([{}, unit]))
        expect(result.rows).toHaveLength(1); expect(result.rows[0].row).toBe(3)
    })
    it("rejects empty, corrupt, oversized files and excessive rows", async () => {
        await expect(service.previewProductPackagingImport(Buffer.alloc(0))).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
        await expect(service.previewProductPackagingImport(Buffer.from("not xlsx"))).rejects.toMatchObject({ key: "errors.packaging_association_import.corrupt" })
        await expect(service.previewProductPackagingImport(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ key: "errors.packaging_association_import.file_size" })
        await expect(service.previewProductPackagingImport(await excel(Array.from({ length: 1001 }, () => unit)))).rejects.toMatchObject({ key: "errors.bulk_import_too_many_rows" })
        noWrites()
    })
    it("generates the minimal downloadable template with instructions and group references", async () => {
        const workbook = await loadWorkbookFromBuffer(await service.buildProductPackagingImportTemplate(["USD only"]))
        expect(workbook.worksheets[0].getRow(1).values).toEqual([undefined, ...Object.values(columns).slice(0, 4).map(column => column.header)])
        expect(workbook.worksheets[1].getCell("A2").value).toBe("USD only")
        expect(workbook.worksheets[2].getCell("A2").value).toBe("Renamed box group")
        expect(JSON.stringify(workbook.worksheets[0].getRow(1).values)).not.toContain("(Q)")
    })
})


describe("simplified four-column associations", () => {
    const fields = ["skuCode", "packagingCode", "group", "isDefault"] as const
    const simpleBox = { ...box, quantityBasis: undefined, quantity: undefined }
    beforeEach(() => {
        for (const [index, basis, value] of [[1, "per_box", 1], [2, "per_pallet", 4], [3, "per_pallet", 1], [4, "per_pallet", 93.3], [6, "per_box", 1]] as const) {
            packagings[index].defaultQuantityBasis = basis
            packagings[index].defaultQuantityValue = value
        }
    })
    it("copies all catalog pallet rules and enriches preview from catalog and variant", async () => {
        variants[0].boxesPerPallet = 198
        const buffer = await excel([unit, simpleBox, { ...unit, packagingCode: "MP-C" }, { ...unit, packagingCode: "MP-T" }, { ...unit, packagingCode: "MP-S" }], [...fields])
        const preview = await service.previewProductPackagingImport(buffer)
        expect(preview.summary).toEqual({ total: 5, new: 5, update: 0, unchanged: 0, error: 0 })
        expect(preview.rows[1]).toMatchObject({ materialName: "Unclassified A", group: "Renamed box group", quantityBasis: "per_box", quantity: 1, quantityPerPallet: 198, ruleSource: "catalog" })
        expect(preview.rows.slice(2).map(row => [row.group, row.isDefault, row.quantity])).toEqual([[null, false, 4], [null, false, 1], [null, false, 93.3]])
        await service.confirmProductPackagingImport(buffer, preview.previewHash)
        expect(PalletMaterial.create).toHaveBeenCalledWith(expect.objectContaining({ packagingId: 21, quantityBasis: "per_box", quantityValue: 1 }), { transaction })
        expect(transaction.staged.some(value => (value as { quantityValue?: number }).quantityValue === 198)).toBe(false)
    })
    it.each([{}, { defaultQuantityBasis: "per_box" }, { defaultQuantityValue: 1 }, { defaultQuantityBasis: "per_box", defaultQuantityValue: 0 }])("blocks new associations with missing/invalid catalog configuration %j", async defaults => {
        delete packagings[1].defaultQuantityBasis; delete packagings[1].defaultQuantityValue
        Object.assign(packagings[1], defaults)
        const result = await service.previewProductPackagingImport(await excel([simpleBox], [...fields]))
        expect(result.rows[0].issues).toContainEqual(expect.objectContaining({ key: "errors.packaging_association_import.missing_consumption", params: { code: "MP-B" } }))
        noWrites()
    })
    it("preserves an existing override without requiring current catalog defaults", async () => {
        const update = jest.fn()
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: null, optionGroup: null, quantityBasis: "per_pallet", quantityValue: "7.00", isDefault: false, isActive: true, update }]
        delete packagings[1].defaultQuantityBasis; delete packagings[1].defaultQuantityValue
        const buffer = await excel([{ ...unit, packagingCode: "MP-B" }], [...fields])
        const result = await service.previewProductPackagingImport(buffer)
        expect(result.rows[0]).toMatchObject({ action: "unchanged", quantity: 7, quantityBasis: "per_pallet", ruleSource: "association" })
        await service.confirmProductPackagingImport(buffer, result.previewHash)
        expect(update).not.toHaveBeenCalled(); noWrites()
    })
    it("updates group/default while preserving the effective quantity", async () => {
        const update = jest.fn()
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: null, optionGroup: null, quantityBasis: "per_pallet", quantityValue: 7, isDefault: false, isActive: true, update }]
        const buffer = await excel([simpleBox], [...fields])
        const result = await service.previewProductPackagingImport(buffer)
        expect(result.rows[0]).toMatchObject({ action: "update", quantity: 7 })
        await service.confirmProductPackagingImport(buffer, result.previewHash)
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ quantityValue: 7, quantityBasis: "per_pallet", optionGroupId: 4, isDefault: true }), { transaction })
    })
    it("preserves existing unit quantity exceptions", async () => {
        mock(UnitMaterial.findAll).mockResolvedValue([{ id: 110, productVariantId: 10, packagingId: 20, optionGroupId: null, optionGroup: null, quantityPerUnit: "2.00", isDefault: false, isActive: true }])
        const result = await service.previewProductPackagingImport(await excel([unit], [...fields]))
        expect(result.rows[0]).toMatchObject({ action: "unchanged", quantity: 2, ruleSource: "association" })
    })
    it("requires an explicit group default even with a persisted default", async () => {
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: 4, optionGroup: "Renamed box group", quantityBasis: "per_box", quantityValue: 1, isDefault: true, isActive: true }]
        const result = await service.previewProductPackagingImport(await excel([{ ...simpleBox, isDefault: undefined }], [...fields]))
        expect(result.rows[0].issues).toContainEqual(expect.objectContaining({ key: "errors.packaging_association_import.default_required" }))
    })
    it("requires exactly one default and matching consumption in each group", async () => {
        for (const rows of [[{ ...simpleBox, isDefault: "NO" }], [simpleBox, { ...simpleBox, packagingCode: "MP-B2" }]]) {
            const result = await service.previewProductPackagingImport(await excel(rows, [...fields]))
            expect(result.rows.every(row => row.issues.some(issue => issue.key.endsWith(".defaults")))).toBe(true)
        }
        packagings[6].defaultQuantityValue = 2
        const result = await service.previewProductPackagingImport(await excel([simpleBox, { ...simpleBox, packagingCode: "MP-B2", isDefault: "NO" }], [...fields]))
        expect(result.rows.every(row => row.issues.some(issue => issue.key.endsWith(".group_quantity")))).toBe(true)
    })
    it.each(["defaultQuantityBasis", "defaultQuantityValue"])("requires repreview after %s changes, including unchanged associations", async field => {
        existing = [{ id: 100, productVariantId: 10, packagingId: 21, optionGroupId: null, optionGroup: null, quantityBasis: "per_pallet", quantityValue: 7, isDefault: false, isActive: true }]
        const buffer = await excel([{ ...unit, packagingCode: "MP-B" }], [...fields])
        const first = await service.previewProductPackagingImport(buffer)
        packagings[1][field] = field === "defaultQuantityBasis" ? "per_pallet" : 5
        const second = await service.previewProductPackagingImport(buffer)
        expect(second.rows[0].action).toBe("unchanged")
        expect(second.previewHash).not.toBe(first.previewHash)
        await expect(service.confirmProductPackagingImport(buffer, first.previewHash)).rejects.toMatchObject({ key: "errors.packaging_association_import.stale_preview" })
        expect(transaction.rollback).toHaveBeenCalled(); noWrites()
    })
    it("legacy quantities remain explicit and blank legacy rules cannot use catalog defaults", async () => {
        const result = await service.previewProductPackagingImport(await excel([{ ...box, quantityBasis: "per_pallet", quantity: 9 }]))
        expect(result.rows[0]).toMatchObject({ quantityBasis: "per_pallet", quantity: 9, ruleSource: "legacy", action: "new" })
        const blank = await service.previewProductPackagingImport(await excel([simpleBox]))
        expect(blank.summary.error).toBe(1)
    })
    it("rolls back a failed write after earlier rows were staged", async () => {
        const buffer = await excel([unit, simpleBox], [...fields])
        const preview = await service.previewProductPackagingImport(buffer)
        mock(PalletMaterial.create).mockRejectedValueOnce(new Error("storage failure"))
        await expect(service.confirmProductPackagingImport(buffer, preview.previewHash)).rejects.toThrow("storage failure")
        expect(transaction.staged).toHaveLength(0); expect(transaction.rollback).toHaveBeenCalled()
    })
})

it("rejects non-finite variant logistics before returning a non-finite reference", async () => {
    variants[0].boxesPerPallet = Infinity
    const result = await service.previewProductPackagingImport(await excel([box]))
    expect(result.rows[0].quantityPerPallet).toBeNull()
    expect(result.rows[0].issues).toContainEqual(expect.objectContaining({ key: "errors.packaging_association_import.boxes_required" }))
    noWrites()
})
it("requires SI/NO in new grouped rows while retaining legacy boolean aliases", async () => {
    packagings[1].defaultQuantityBasis = "per_box"; packagings[1].defaultQuantityValue = 1
    const fields = ["skuCode", "packagingCode", "group", "isDefault"] as (keyof typeof columns)[]
    const result = await service.previewProductPackagingImport(await excel([{ ...box, isDefault: "TRUE" }], fields))
    expect(result.rows[0].issues).toContainEqual(expect.objectContaining({ key: "errors.packaging_association_import.boolean" }))
    expect((await service.previewProductPackagingImport(await excel([{ ...box, isDefault: "TRUE" }]))).summary.error).toBe(0)
})
