jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn() } }))
jest.mock("../../client/models/Client.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../models/Juice.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceRawMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceSpiceMaterial.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceMix.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../models/JuiceSpice.model", () => ({ __esModule: true, default: { create: jest.fn() } }))
jest.mock("../models/JuicePresentation.model", () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }))
jest.mock("../models/JuiceCostConstants.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../models/JuiceClientConstantOverride.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))

import ExcelJS from "exceljs"
import { UniqueConstraintError } from "sequelize"
import connection from "../../../database/connection"
import Client from "../../client/models/Client.model"
import Juice from "../models/Juice.model"
import Raw from "../models/JuiceRawMaterial.model"
import SpiceMaterial from "../models/JuiceSpiceMaterial.model"
import Mix from "../models/JuiceMix.model"
import Spice from "../models/JuiceSpice.model"
import Presentation from "../models/JuicePresentation.model"
import Global from "../models/JuiceCostConstants.model"
import Override from "../models/JuiceClientConstantOverride.model"
import { bulkImportJuices, buildJuiceImportTemplate } from "./juiceImport.service"
import { loadWorkbookFromBuffer, writeWorkbookToBuffer } from "../../../shared/utils/excelImport.util"
import { JUICE_IMPORT_SHEETS as names, JUICE_MATERIAL_HEADERS as mh, JUICE_PRESENTATION_HEADERS as ph } from "../constants/juiceImport.constant"
import { parityPhysical, parityConstants } from "./juiceParity.fixture"
import { buildJuiceCostLines } from "./juiceCostLines"
import { BulkImportError } from "../../../shared/errors/AppError"

const transaction = { LOCK: { SHARE: "SHARE" } }
let written: Record<string, unknown>[]
beforeEach(() => {
    jest.resetAllMocks()
    written = []
    const transactionMock = jest.requireMock("../../../database/connection").default.transaction as jest.Mock
    transactionMock.mockImplementation(async (operation: unknown) => {
        try { return await (operation as (tx: unknown) => Promise<unknown>)(transaction) }
        catch (error) { written = []; throw error }
    })
    for (const model of [Raw, SpiceMaterial, Juice, Presentation]) {
        jest.mocked(model.findAll).mockResolvedValue([])
    }
    for (const [name, model] of [["raw", Raw], ["spiceMaterial", SpiceMaterial], ["juice", Juice], ["mix", Mix], ["spice", Spice], ["physical", Presentation]] as const) {
        jest.mocked(model.create).mockImplementation(async (values: unknown) => {
            const row = { id: written.length + 1, table: name, ...(values as Record<string, unknown>) }
            written.push(row)
            return row as never
        })
    }
    jest.mocked(Client.findAll).mockResolvedValue([{ id: 9, name: "ACME", isActive: true }] as never)
    jest.mocked(Global.findOne).mockResolvedValue({ ...parityConstants, revision: 2 } as never)
    jest.mocked(Override.findAll).mockResolvedValue([])
})

function physicalValues(juice = "CP") {
    return { juice, pricePerPound: 2.025852, displayLabel: "6x354 ML", ...Object.fromEntries(Object.entries(parityPhysical).map(([key, value]) => [key, Number(value)])) }
}
function addPhysical(workbook: ExcelJS.Workbook, values: Record<string, unknown> = physicalValues()) {
    workbook.getWorksheet(names.presentations)!.addRow(Object.keys(ph).map(key => values[key]))
}
async function fixture() {
    const workbook = await loadWorkbookFromBuffer(await buildJuiceImportTemplate())
    workbook.getWorksheet(names.materials)!.addRows([
        ["MATERIA PRIMA", "OR", "NARANJA", "LIBRA", 1, 1.87391],
        ["MATERIA PRIMA", "PI", "PIÑA PRENSA", "LITRO", 1, 0],
        ["MATERIA PRIMA", "CA", "ZANAHORIA", "GRAMO", 1, 0.62201],
        ["ESPECIA", "GI", "JENGIBRE POLVO", "GRAMO", null, 0.028105154757],
    ])
    const formula = workbook.getWorksheet(names.formulas)!
    formula.getCell("C2").value = "ACME"; formula.getCell("C3").value = "CP"; formula.getCell("C4").value = "CARROT PINEAPPLE JUICE"
    formula.addRows([["MATERIA PRIMA", "OR", 0.15], ["MATERIA PRIMA", "PI", 0.42], ["MATERIA PRIMA", "CA", 0.43], ["ESPECIA", "GI", 0.35]])
    addPhysical(workbook)
    return workbook
}
const run = async (workbook: ExcelJS.Workbook) => bulkImportJuices(await writeWorkbookToBuffer(workbook))
function physicalColumn(field: keyof typeof ph) { return Object.keys(ph).indexOf(field) + 1 }

describe("three-sheet fixed juice import", () => {
    test("imports multiple matrix columns, creates collision-safe slugs and resolves each SKU", async () => {
        const workbook = await fixture()
        const matrix = workbook.getWorksheet(names.formulas)!
        for (let row = 1; row <= 8; row++) matrix.getRow(row).getCell(4).value = matrix.getRow(row).getCell(3).value
        matrix.getCell("D1").value = "Jugo 2"; matrix.getCell("D3").value = "CP2"
        addPhysical(workbook, { ...physicalValues("CP2"), displayLabel: "12x354 ML", bottlesPerCase: 12 })
        const counts = await run(workbook)
        expect(counts).toMatchObject({ juices: 2, mixRows: 6, spiceRows: 2, presentations: 2 })
        expect(written.filter(row => row.table === "juice").map(row => row.urlSlug)).toEqual(["carrot-pineapple-juice", "carrot-pineapple-juice-2"])
    })
    test("catalog-only file uses the same atomic pipeline without requiring globals", async () => {
        const workbook = await loadWorkbookFromBuffer(await buildJuiceImportTemplate())
        workbook.getWorksheet(names.materials)!.addRow(["MATERIA PRIMA", "ZERO", "Own press", "LIBRA", 1, 0])
        jest.mocked(Global.findOne).mockResolvedValue(null)
        await expect(run(workbook)).resolves.toMatchObject({ rawMaterials: 1, juices: 0, globalRevision: null })
        expect(Raw.create).toHaveBeenCalledWith(expect.objectContaining({ costPerLiter: 0 }), { transaction })
    })
    test("adds presentations to an existing juice without recreating it or changing its price", async () => {
        const workbook = await loadWorkbookFromBuffer(await buildJuiceImportTemplate())
        jest.mocked(Juice.findAll).mockResolvedValue([{ id: 7, code: "CP", displayName: "Carrot", clientId: 9, isActive: true, pricePerPound: "2.025852", urlSlug: "carrot" }] as never)
        jest.mocked(Override.findAll).mockResolvedValue([{ id: 20, clientId: 9, isActive: true }] as never)
        addPhysical(workbook)
        await expect(run(workbook)).resolves.toMatchObject({ juices: 0, presentations: 1, clientOverrideIds: [20] })
        expect(Juice.create).not.toHaveBeenCalled()
        expect(Presentation.create).toHaveBeenCalledWith(expect.objectContaining({ juiceId: 7 }), { transaction })
    })
    test("unknown zero/blank matrix components are omitted, cached percentages stay fractions", async () => {
        const workbook = await fixture()
        workbook.getWorksheet(names.formulas)!.addRows([["MATERIA PRIMA", "NOT USED", 0], ["ESPECIA", "NOT USED", null]])
        workbook.getWorksheet(names.formulas)!.getCell("C5").value = { formula: "15/100", result: 0.15 }
        await expect(run(workbook)).resolves.toMatchObject({ mixRows: 3, spiceRows: 1 })
    })
    test("mapped headers tolerate reordered columns and rich text", async () => {
        const workbook = await fixture()
        const materials = workbook.getWorksheet(names.materials)!
        for (let row = 1; row <= materials.rowCount; row++) {
            const first = materials.getRow(row).getCell(1).value
            materials.getRow(row).getCell(1).value = materials.getRow(row).getCell(2).value
            materials.getRow(row).getCell(2).value = first
        }
        materials.getCell("A1").value = { richText: [{ text: "codigo" }] }
        await expect(run(workbook)).resolves.toMatchObject({ rawMaterials: 3 })
    })
    test("inactive/ambiguous client names fail before writes", async () => {
        jest.mocked(Client.findAll).mockResolvedValue([{ id: 9, name: "ACME", isActive: false }] as never)
        await expect(run(await fixture())).rejects.toMatchObject({ rowIssues: expect.arrayContaining([expect.objectContaining({ field: "% MP!C", key: "errors.juice_import_reference" })]) })
        jest.mocked(Client.findAll).mockResolvedValue([{ id: 9, name: "ACME", isActive: true }, { id: 10, name: "Acme", isActive: true }] as never)
        await expect(run(await fixture())).rejects.toBeInstanceOf(BulkImportError)
        expect(written).toHaveLength(0)
    })
    test("rejects duplicate components, duplicate presentations and totals below 100%", async () => {
        const workbook = await fixture()
        workbook.getWorksheet(names.formulas)!.getCell("C5").value = 0.1
        workbook.getWorksheet(names.formulas)!.addRow(["MATERIA PRIMA", "OR", 0.05])
        addPhysical(workbook)
        await expect(run(workbook)).rejects.toMatchObject({ rowIssues: expect.arrayContaining([
            expect.objectContaining({ key: "errors.juice_import_duplicate_component" }),
            expect.objectContaining({ key: "errors.juice_mix_incomplete" }),
            expect.objectContaining({ key: "errors.juice_duplicate" }),
        ]) })
        expect(written).toHaveLength(0)
    })
    test("enforces bounded rows and juice columns", async () => {
        const workbook = await fixture()
        workbook.getWorksheet(names.materials)!.getRow(1002).getCell(1).value = "MATERIA PRIMA"
        await expect(run(workbook)).rejects.toMatchObject({ key: "errors.bulk_import_too_many_rows" })
        const wide = await fixture()
        wide.getWorksheet(names.formulas)!.getRow(2).getCell(103).value = "ACME"
        await expect(run(wide)).rejects.toMatchObject({ key: "errors.juice_import_columns" })
        expect(connection.transaction).not.toHaveBeenCalled()
    })
    test("template has all sheets/instructions and does not create dummy data", async () => {
        const workbook = await loadWorkbookFromBuffer(await buildJuiceImportTemplate())
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([names.materials, names.formulas, names.presentations, "Instrucciones"])
        expect(workbook.getWorksheet("Instrucciones")!.rowCount).toBeGreaterThan(10)
        await expect(run(workbook)).rejects.toMatchObject({ key: "errors.bulk_import_empty_file" })
        expect(written).toHaveLength(0)
    })
    test("creates all catalogs/formulas/presentation atomically and preserves corrected J2 parity", async () => {
        const counts = await run(await fixture())
        expect(counts).toMatchObject({ rawMaterials: 3, spiceMaterials: 1, juices: 1, mixRows: 3, spiceRows: 1, presentations: 1, globalRevision: 2 })
        for (const model of [Raw, SpiceMaterial, Juice, Mix, Spice, Presentation]) {
            expect(model.create).toHaveBeenCalledWith(expect.any(Object), { transaction })
        }
        const raws = written.filter(row => row.table === "raw")
        const ingredients = written.filter(row => row.table === "spiceMaterial")
        const recipe = {
            rawMaterials: written.filter(row => row.table === "mix").map(row => {
                const raw = raws.find(material => material.id === row.rawMaterialId)!
                return { rawMaterialId: Number(raw.id), displayName: String(raw.displayName), percentage: Number(row.percentage), costPerLiter: Number(raw.costPerLiter) }
            }),
            spices: written.filter(row => row.table === "spice").map(row => ({ spiceMaterialId: Number(row.spiceMaterialId), displayName: String(ingredients[0].displayName), gramsPerLiter: Number(row.gramsPerLiter), costPerGram: Number(ingredients[0].costPerGram) })),
        }
        expect(raws.find(row => row.code === "PI")?.costPerLiter).toBe(0)
        const input = jest.mocked(Presentation.create).mock.calls[0][0]!
        const result = buildJuiceCostLines(recipe, input as never, parityConstants, Number(written.find(row => row.table === "juice")!.pricePerPound), 1)
        expect(result.rawMaterialCostPerPound).toBeCloseTo(0.253282955713, 12)
        expect(result.pricePerCase).toBe(9.1678)
        expect(result.pricePerPound).toBe(1.9579)
        expect(connection.transaction).toHaveBeenCalledTimes(1)
    })
    test("collects worksheet/row/column errors and writes nothing if a late presentation is invalid", async () => {
        const workbook = await fixture()
        workbook.getWorksheet(names.formulas)!.getCell("C5").value = 15 // Fractions, never infer 15%.
        workbook.getWorksheet(names.presentations)!.getRow(2).getCell(physicalColumn("bottlesPerCase")).value = 0
        try { await run(workbook); throw new Error("expected rejection") }
        catch (error) {
            expect(error).toBeInstanceOf(BulkImportError)
            const issues = (error as BulkImportError).rowIssues
            expect(issues).toEqual(expect.arrayContaining([
                expect.objectContaining({ row: 5, field: "% MP!C", key: "errors.juice_import_fraction" }),
                expect.objectContaining({ row: 2, field: `${names.presentations}!bottlesPerCase` }),
            ]))
        }
        expect(Raw.create).not.toHaveBeenCalled()
        expect(written).toHaveLength(0)
    })
    test("failure during the final write propagates through the single rollback transaction", async () => {
        jest.mocked(Presentation.create).mockRejectedValue(new Error("database write failed"))
        await expect(run(await fixture())).rejects.toThrow("database write failed")
        expect(Juice.create).toHaveBeenCalled()
        expect(written).toHaveLength(0)
    })
    test("concurrent uniqueness collision rolls back all sheets and surfaces a conflict", async () => {
        jest.mocked(Juice.create).mockRejectedValue(new UniqueConstraintError({}))
        await expect(run(await fixture())).rejects.toMatchObject({ statusCode: 409, key: "errors.juice_duplicate" })
        expect(written).toHaveLength(0)
    })
    test("rejects existing inactive codes and duplicate file codes", async () => {
        jest.mocked(Raw.findAll).mockResolvedValue([{ id: 1, code: "or", displayName: "Orange", isActive: false }] as never)
        const workbook = await fixture()
        workbook.getWorksheet(names.materials)!.addRow(["MATERIA PRIMA", "CA", "Other", "LIBRA", 1, 1])
        await expect(run(workbook)).rejects.toMatchObject({ rowIssues: expect.arrayContaining([expect.objectContaining({ key: "errors.juice_duplicate" })]) })
        expect(written).toHaveLength(0)
    })
    test("resolves existing active materials by name with case/accent tolerance", async () => {
        jest.mocked(Raw.findAll).mockResolvedValue([{ id: 55, code: "EX", displayName: "NARÁNJA", isActive: true }] as never)
        const workbook = await fixture()
        workbook.getWorksheet(names.materials)!.spliceRows(2, 1)
        workbook.getWorksheet(names.formulas)!.getCell("B5").value = " naranja "
        await expect(run(workbook)).resolves.toMatchObject({ rawMaterials: 2 })
        expect(Mix.create).toHaveBeenCalledWith(expect.objectContaining({ rawMaterialId: 55 }), { transaction })
    })
    test.each([false, true])("unknown/ambiguous reference is an error (ambiguous=%s)", ambiguous => {
        // Async setup kept inside the returned promise for Jest.
        return fixture().then(async workbook => {
            if (ambiguous) jest.mocked(Raw.findAll).mockResolvedValue([{ id: 55, code: "EX", displayName: "Same", isActive: true }, { id: 56, code: "EX2", displayName: "Sáme", isActive: true }] as never)
            workbook.getWorksheet(names.formulas)!.getCell("B5").value = ambiguous ? "same" : "Missing"
            await expect(run(workbook)).rejects.toMatchObject({ rowIssues: expect.arrayContaining([expect.objectContaining({ key: "errors.juice_import_reference" })]) })
            expect(written).toHaveLength(0)
        })
    })
    test("all presentation prices must match the juice-level PRICE LB", async () => {
        const workbook = await fixture()
        addPhysical(workbook, { ...physicalValues(), displayLabel: "12x354", bottlesPerCase: 12, pricePerPound: 3 })
        await expect(run(workbook)).rejects.toMatchObject({ rowIssues: expect.arrayContaining([expect.objectContaining({ key: "errors.juice_import_price_mismatch" })]) })
        expect(written).toHaveLength(0)
    })
    test("new juice needs at least one presentation; existing juice cannot be recreated", async () => {
        const workbook = await fixture()
        workbook.getWorksheet(names.presentations)!.spliceRows(2, 1)
        await expect(run(workbook)).rejects.toMatchObject({ rowIssues: expect.arrayContaining([expect.objectContaining({ key: "errors.juice_import_presentation_required" })]) })
        jest.mocked(Juice.findAll).mockResolvedValue([{ id: 7, code: "cp", displayName: "CP", isActive: false }] as never)
        await expect(run(await fixture())).rejects.toMatchObject({ rowIssues: expect.arrayContaining([expect.objectContaining({ key: "errors.juice_duplicate" })]) })
    })
    test("requires global config without writing or resetting globals/overrides", async () => {
        jest.mocked(Global.findOne).mockResolvedValue(null)
        await expect(run(await fixture())).rejects.toMatchObject({ rowIssues: expect.arrayContaining([expect.objectContaining({ key: "errors.juice_config_required" })]) })
        expect(written).toHaveLength(0)
    })
    test("rejects missing sheets, headers, duplicate headers and corrupted files", async () => {
        const workbook = await fixture()
        workbook.removeWorksheet(names.materials)
        await expect(run(workbook)).rejects.toMatchObject({ key: "errors.juice_import_sheet" })
        const missing = await fixture()
        missing.getWorksheet(names.materials)!.getCell("B1").value = "unknown"
        await expect(run(missing)).rejects.toMatchObject({ key: "errors.bulk_import_missing_columns" })
        const duplicate = await fixture()
        duplicate.getWorksheet(names.materials)!.getCell("G1").value = mh.code
        await expect(run(duplicate)).rejects.toMatchObject({ key: "errors.juice_import_duplicate_header" })
        await expect(bulkImportJuices(Buffer.from("invalid"))).rejects.toMatchObject({ key: "errors.juice_import_workbook" })
    })
    test("spice type requires grams with no liquid yield; missing numeric cells never become zero", async () => {
        const workbook = await fixture()
        workbook.getWorksheet(names.materials)!.getCell("D5").value = "LIBRA"
        workbook.getWorksheet(names.presentations)!.getRow(2).getCell(physicalColumn("secondStickerUnitCost")).value = null
        await expect(run(workbook)).rejects.toMatchObject({ rowIssues: expect.arrayContaining([expect.objectContaining({ key: "errors.juice_import_spice_unit" }), expect.objectContaining({ field: `${names.presentations}!secondStickerUnitCost` })]) })
    })
})
