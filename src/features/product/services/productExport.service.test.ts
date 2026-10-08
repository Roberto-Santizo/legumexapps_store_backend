import "reflect-metadata"
import ExcelJS from "exceljs"
import { Model } from "sequelize-typescript"
import { Transaction } from "sequelize"
import Product from "../models/Product.model"
import { buildProductExportWorkbook, ProductExportData, productExportService } from "./productExport.service"

function fixture(): ProductExportData {
    return {
        products: [{ id: 1, displayName: "=Fruit", subCategoryId: 2, clientId: 3, isActive: false, isOrganic: true, isCustomizable: true, additionalCostPerUnit: "0.0123" }],
        translations: [{ id: 1, productId: 1, language: "en", displayName: "Fruit mix" }],
        variants: [{ id: 10, productId: 1, skuCode: "000123", presentationId: 4, boxesPerPallet: 40, bagsPerBox: 6, unitsPerIntermediatePackage: 12, isActive: false }],
        recipes: [{ id: 11, productId: 1, rawMaterialId: 5, percentage: null, minPercentage: "10.00", maxPercentage: "90.00", isActive: false }],
        ingredients: [{ id: 12, productId: 1, ingredientId: 6, grams: "1.234", referenceNetWeightGrams: "500", isActive: true }],
        unitMaterials: [{ id: 13, productVariantId: 10, packagingId: 7, quantityPerUnit: "2.50", optionGroupId: 9, optionGroup: "Bag", isDefault: true, isActive: true }, { id: 14, productVariantId: 10, packagingId: 8, quantityPerUnit: 1, optionGroupId: 9, isDefault: false, isActive: false }],
        intermediateMaterials: [{ id: 15, productVariantId: 10, packagingId: 7, isActive: true }],
        palletMaterials: [{ id: 16, productVariantId: 10, packagingId: 8, quantityValue: "93.30", quantityBasis: "per_pallet", isActive: true }],
        categories: [{ id: 20, displayName: "Frozen" }], subCategories: [{ id: 2, categoryId: 20, displayName: "Fruit" }], clients: [{ id: 3, name: "Client" }],
        presentations: [{ id: 4, displayLabel: "500 g", netWeightGrams: "500", isActive: true }],
        rawMaterials: [{ id: 5, code: "0005", displayName: "Mango", ingredientType: "fruit", costPerUnit: "1.2345", costUnitId: 30, isActive: false }],
        ingredientCatalog: [{ id: 6, code: "006", displayName: "Salt", costPerUnit: "0.0123", costUnitId: 30, isActive: true }],
        packagings: [{ id: 7, code: "007", displayName: "Bag", packagingRole: "unit", unitCost: "0.0123", isActive: true }, { id: 8, code: "008", displayName: "Box", unitCost: "2.3456", defaultQuantityBasis: "per_box", defaultQuantityValue: 1, isActive: false }],
        groups: [{ id: 9, displayName: "Bags" }], units: [{ id: 30, displayName: "Pound", baseFactor: "453.592" }],
        costs: [{ id: 31, displayName: "Unexpected", calculationType: "percentage", value: "2.0000", isActive: true }],
    }
}
it("exports all configurations, inactive alternatives, precise costs and text codes in a readable XLSX", async () => {
    const original = fixture()
    const workbook = buildProductExportWorkbook(original, new Date("2026-10-08T12:00:00Z"))
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer())
    expect(reopened.worksheets.map(sheet => sheet.name)).toEqual(["Productos", "Variantes", "Materias primas", "Ingredientes", "Empaques unidad", "Empaques intermedios", "Materiales pallet", "Costos globales", "Información"])
    expect(reopened.getWorksheet("Productos")!.getCell("B2").value).toBe("=Fruit")
    expect(reopened.getWorksheet("Productos")!.getCell("C2").value).toBe("Fruit mix")
    expect(reopened.getWorksheet("Productos")!.getCell("L2").value).toBe(0.0123)
    expect(reopened.getWorksheet("Productos")!.getCell("M2").value).toBe(false)
    expect(reopened.getWorksheet("Variantes")!.getCell("D2").value).toBe("000123")
    expect(reopened.getWorksheet("Materias primas")!.getCell("L2").value).toBe(10)
    expect(reopened.getWorksheet("Ingredientes")!.getCell("K2").value).toBe(1.234)
    expect(reopened.getWorksheet("Materias primas")!.getCell("A2").value).toBe("000123")
    expect(reopened.getWorksheet("Materias primas")!.getCell("B2").value).toBe("500 g")
    expect(reopened.getWorksheet("Materias primas")!.getColumn(5).hidden).toBe(true)
    expect(reopened.getWorksheet("Materias primas")!.getColumn(1).hidden).toBe(false)
    const bags = reopened.getWorksheet("Empaques unidad")!
    expect(bags.rowCount).toBe(3)
    expect(bags.getCell("J2").value).toBe(0.0123)
    expect(bags.getCell("N2").value).toBe(9)
    expect(bags.getCell("Q2").value).toBe(true)
    expect(bags.getCell("R3").value).toBe(false)
    expect(reopened.getWorksheet("Empaques intermedios")!.getCell("M2").value).toBe(12)
    expect(reopened.getWorksheet("Materiales pallet")!.getCell("K2").value).toBe(93.3)
    expect(reopened.getWorksheet("Materiales pallet")!.getCell("L2").value).toBe("per_pallet")
    expect(reopened.getWorksheet("Costos globales")!.getCell("D2").value).toBe(2)
    for (const sheet of reopened.worksheets) { expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 }); expect(sheet.autoFilter).toBeDefined() }
    expect(original.products[0].additionalCostPerUnit).toBe("0.0123")
})
it("exports empty catalogs with all headers and keeps unresolved references visible", () => {
    const data = fixture()
    for (const key of Object.keys(data) as (keyof ProductExportData)[]) data[key] = []
    expect(buildProductExportWorkbook(data).getWorksheet("Productos")!.rowCount).toBe(1)
    data.unitMaterials = [{ id: 1, productVariantId: 999, packagingId: 888, isActive: true }]
    const row = buildProductExportWorkbook(data).getWorksheet("Empaques unidad")!
    expect(row.getCell("C2").value).toBe(999)
    expect(row.getCell("F2").value).toBe(888)
})
it("associates shared recipes with every SKU, including inactive variants, without dropping products with no variants", () => {
    const data = fixture()
    data.variants.push({ id: 20, productId: 1, skuCode: "SECOND", presentationId: 40, isActive: true })
    data.presentations.push({ id: 40, displayLabel: "2 kg" })
    data.recipes.push({ id: 90, productId: 999, rawMaterialId: 5, percentage: 100 })
    const workbook = buildProductExportWorkbook(data)
    const recipes = workbook.getWorksheet("Materias primas")!
    expect(recipes.rowCount).toBe(4)
    expect(recipes.getCell("A2").value).toBe("000123")
    expect(recipes.getCell("C2").value).toBe(false)
    expect(recipes.getCell("A3").value).toBe("SECOND")
    expect(recipes.getCell("B3").value).toBe("2 kg")
    expect(recipes.getCell("A4").value).toBe("Sin SKU / No SKU")
    const ingredients = workbook.getWorksheet("Ingredientes")!
    expect(ingredients.rowCount).toBe(3)
    expect(ingredients.getCell("A3").value).toBe("SECOND")
    expect(ingredients.getCell("K3").value).toBe(1.234)
})
it("reads every report table in one read-only repeatable snapshot without accessing a real database", async () => {
    const transaction = { id: "export-snapshot" } as unknown as Transaction
    const run = jest.fn(async (_options: unknown, work: (t: Transaction) => Promise<unknown>) => work(transaction))
    const descriptor = Object.getOwnPropertyDescriptor(Product, "sequelize")
    const reads = jest.spyOn(Model, "findAll").mockResolvedValue([])
    Object.defineProperty(Product, "sequelize", { configurable: true, value: { transaction: run } })
    try {
        const buffer = await productExportService.exportProductCatalog()
        expect(Buffer.isBuffer(buffer)).toBe(true)
        expect(run).toHaveBeenCalledWith({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, expect.any(Function))
        expect(reads).toHaveBeenCalledTimes(18)
        for (const [options] of reads.mock.calls) expect(options).toEqual({ transaction, order: [["id", "ASC"]] })
    } finally {
        reads.mockRestore()
        if (descriptor) Object.defineProperty(Product, "sequelize", descriptor)
        else Reflect.deleteProperty(Product, "sequelize")
    }
})
