import "reflect-metadata";
import ExcelJS from "exceljs";
jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn(async (_options, work) => work({ LOCK: { SHARE: "SHARE" } })), query: jest.fn().mockResolvedValue([]) } }));
jest.mock("../models/GenericPackagingConfiguration.model", () => ({ __esModule: true, default: { findAll: jest.fn().mockResolvedValue([]) } }));
jest.mock("./genericPackaging.service", () => ({ genericCatalogOptions: jest.fn(), saveGenericProfile: jest.fn().mockResolvedValue(1) }));
import { genericCatalogOptions, saveGenericProfile } from "./genericPackaging.service";
import Profile from "../models/GenericPackagingConfiguration.model";
import { planGenericImport, confirmGenericImport, buildGenericTemplate, GENERIC_SHEET, GENERIC_COLUMNS } from "./genericPackagingImport.service";
import { writeWorkbookToBuffer } from "../../../shared/utils/excelImport.util";

const row = <T extends object>(value: T) => ({ ...value, toJSON: () => value });
const material = (id: number, displayName: string, packagingRole: string, defaults: Record<string, unknown> = {}) =>
    row({ id, code: `GEN-${id}`, displayName, displayNameEn: displayName, packagingRole, classification: "generic", isActive: true, unitCost: "0.5", defaultQuantityBasis: null, defaultQuantityValue: null, ...defaults });
const catalogs = () => ({
    categories: [row({ id: 1, displayName: "Frutas", isActive: true })],
    presentations: [row({ id: 2, displayLabel: "16 oz", netWeightGrams: 454, isActive: true })],
    groups: [row({ id: 3, displayName: "Bolsa", isActive: true }), row({ id: 4, displayName: "Paletizado", isActive: true }), row({ id: 5, displayName: "Intermedio", isActive: true })],
    materials: [material(10, "Bolsa zipper", "unit"), material(11, "Bolsa simple", "unit"), material(20, "Separador genérico", "pallet", { materialType: "OTRO", defaultQuantityBasis: "per_pallet", defaultQuantityValue: "1.00" }),
        material(21, "Fleje genérico", "pallet", { materialType: "OTRO", defaultQuantityBasis: "per_pallet", defaultQuantityValue: "93.30" }), material(22, "Film sin tipo", "pallet", { materialType: "OTRO" }), material(23, "Tarima del kit", "pallet", { materialType: "TARIMA", defaultQuantityBasis: "per_pallet", defaultQuantityValue: "1.00" }), material(30, "Bolsa grande", "intermediate")],
});
beforeEach(() => { jest.clearAllMocks(); (genericCatalogOptions as jest.Mock).mockResolvedValue(catalogs()); (Profile.findAll as jest.Mock).mockResolvedValue([]); });

const configurationRow = ["C1", "Frutas 5x16", "Frutas", "16 oz", 5, 60, ""];
const blank = ["", "", "", "", "", "", ""];
async function excel(rows: unknown[][] = [
    [...configurationRow, "individual", "Bolsa", "ELIGE UNO", "Bolsa zipper", ""],
    [...blank, "individual", "Bolsa", "ELIGE UNO", "Bolsa simple", ""],
    [...blank, "pallet", "Paletizado", "INCLUIDO SIEMPRE", "Separador genérico", ""],
    [...blank, "pallet", "Paletizado", "INCLUIDO SIEMPRE", "Fleje genérico", ""],
], change?: (sheet: ExcelJS.Worksheet) => void) {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet(GENERIC_SHEET);
    sheet.addRow([...GENERIC_COLUMNS]);
    rows.forEach(values => sheet.addRow(values));
    change?.(sheet);
    return writeWorkbookToBuffer(workbook);
}
const issueKeys = async (rows: unknown[][]) => (await planGenericImport(await excel(rows))).issues.map(issue => [issue.row, issue.field, issue.key]);

it("one worksheet: rows sharing a reference become one configuration with catalog consumption, then confirm saves it", async () => {
    const file = await excel(), plan = await planGenericImport(file);
    expect(plan.issues).toEqual([]);
    expect(plan.summary).toEqual({ configurations: 1, errors: 0 });
    expect(plan.profiles[0].input).toMatchObject({ reference: "C1", displayName: "Frutas 5x16", categoryId: 1, presentationId: 2, bagsPerBox: 5, boxesPerPallet: 60, unitsPerIntermediatePackage: null, groups: [
        { packagingGroupId: 3, level: "unit", selectionMode: "one", isRequired: true, options: [{ packagingId: 10, quantityBasis: "per_unit", quantityValue: 1 }, { packagingId: 11, quantityBasis: "per_unit", quantityValue: 1 }] },
        { packagingGroupId: 4, level: "pallet", selectionMode: "all", isRequired: true, options: [{ packagingId: 20, quantityBasis: "per_pallet", quantityValue: 1 }, { packagingId: 21, quantityBasis: "per_pallet", quantityValue: 93.3 }] },
    ] });
    expect(saveGenericProfile).not.toHaveBeenCalled();
    await confirmGenericImport(file, plan.previewHash);
    expect(saveGenericProfile).toHaveBeenCalledWith(plan.profiles[0].input, undefined, expect.anything());
});
it("accepts material codes, quantity overrides, several configurations and repeated identical configuration data", async () => {
    const plan = await planGenericImport(await excel([
        [...configurationRow, "individual", "Bolsa", "ELIGE UNO", "gen-10", 2],
        [...configurationRow, "pallet", "Paletizado", "INCLUIDO SIEMPRE", "Fleje genérico", 90],
        ["C2", "Otra", "frutas", "16 OZ", 6, 40, 3, "intermedio", "Intermedio", "OPCIONAL", "Bolsa grande", ""],
        ["C2", "", "", "", "", "", "", "pallet", "Paletizado", "incluido siempre", "Separador genérico", ""],
    ]));
    expect(plan.issues).toEqual([]);
    expect(plan.profiles.map(profile => profile.input.reference)).toEqual(["C1", "C2"]);
    expect(plan.profiles[0].input.groups.flatMap(group => group.options)).toEqual([{ packagingId: 10, quantityBasis: "per_unit", quantityValue: 2 }, { packagingId: 21, quantityBasis: "per_pallet", quantityValue: 90 }]);
    expect(plan.profiles[1].input.groups[0]).toMatchObject({ level: "intermediate", selectionMode: "one", isRequired: false, options: [{ packagingId: 30, quantityBasis: "per_intermediate", quantityValue: null }] });
});
it("reports each problem on its own row and field, and nothing is saved", async () => {
    expect(await issueKeys([
        ["C1", "", "Frutas", "16 oz", 5, 60, "", "individual", "Bolsa", "ELIGE UNO", "Bolsa zipper", ""],
        ["C1", "", "", "", 7, "", "", "pallet", "Paletizado", "INCLUIDO SIEMPRE", "No existe", ""],
        ["C1", "", "", "", "", "", "", "pallet", "Paletizado", "ELIGE UNO", "Fleje genérico", ""],
        ["C1", "", "", "", "", "", "", "pallet", "Paletizado", "INCLUIDO SIEMPRE", "Film sin tipo", ""],
        ["C1", "", "", "", "", "", "", "intermedio", "Intermedio", "OPCIONAL", "Bolsa grande", 4],
        ["", "", "", "", "", "", "", "pallet", "Paletizado", "A VECES", "Separador genérico", ""],
    ])).toEqual([
        [2, "Nombre", "errors.generic_packaging_import_first_row"],
        [3, "Unidades por caja", "errors.generic_packaging_import_mismatch"],
        [3, "Material", "errors.generic_packaging_import_material_unknown"],
        [4, "Uso", "errors.generic_packaging_import_usage"],
        [5, "Material", "errors.generic_packaging_import_no_consumption"],
        [6, "Cantidad", "errors.generic_packaging_import_quantity"],
        [7, "Uso", "errors.generic_packaging_import_usage"],
        [2, "Unidades por intermedio", "errors.generic_packaging_import_first_row"],
    ]);
});
it("rejects existing references, ambiguous names, unknown catalog values and empty files", async () => {
    (Profile.findAll as jest.Mock).mockResolvedValue([{ reference: "c1" }]);
    expect(await issueKeys([[...configurationRow, "individual", "Bolsa", "ELIGE UNO", "Bolsa zipper", ""]])).toEqual([[2, "Referencia", "errors.generic_packaging_import_reference"]]);
    (Profile.findAll as jest.Mock).mockResolvedValue([]);
    const options = catalogs(); options.materials.push(material(12, "Bolsa zipper", "unit"));
    (genericCatalogOptions as jest.Mock).mockResolvedValue(options);
    expect(await issueKeys([[...configurationRow, "individual", "Bolsa", "ELIGE UNO", "Bolsa zipper", ""]])).toEqual([[2, "Material", "errors.generic_packaging_import_material_ambiguous"]]);
    expect(await issueKeys([["C1", "N", "Otra", "16 oz", 5, 60, "", "individual", "Bolsa", "ELIGE UNO", "gen-10", ""]])).toEqual([[2, "Categoría", "errors.generic_packaging_import_invalid"]]);
    expect(await issueKeys([])).toEqual([[2, "row", "errors.generic_packaging_import_13"]]);
    expect(await issueKeys([["", "N", "Frutas", "16 oz", 5, 60, "", "individual", "Bolsa", "ELIGE UNO", "gen-10", ""]])).toEqual([[2, "Referencia", "errors.generic_packaging_import_reference"]]);
});
it("the intermediate level requires units per intermediate package, like the form", async () => {
    expect(await issueKeys([[...configurationRow, "intermedio", "Intermedio", "INCLUIDO SIEMPRE", "Bolsa grande", ""]])).toEqual([[2, "Unidades por intermedio", "errors.generic_packaging_import_first_row"]]);
});
it("structural problems stop before reading rows; formulas and changed previews are rejected", async () => {
    expect((await planGenericImport(await excel(undefined, sheet => { sheet.getCell("J1").value = "Modo"; }))).issues).toEqual([expect.objectContaining({ row: 1, field: "Uso", key: "errors.generic_packaging_import_2" })]);
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Otra");
    expect((await planGenericImport(await writeWorkbookToBuffer(workbook))).issues).toEqual([expect.objectContaining({ field: "sheet", key: "errors.generic_packaging_import_0" })]);
    expect((await planGenericImport(await excel(undefined, sheet => { sheet.getCell("E2").value = { formula: "2+3", result: 5 }; }))).issues).toEqual([expect.objectContaining({ row: 2, field: "row", key: "errors.generic_packaging_import_4" })]);
    await expect(confirmGenericImport(await excel(), "0".repeat(64))).rejects.toMatchObject({ statusCode: 409 });
    expect(saveGenericProfile).not.toHaveBeenCalled();
});
it("downloads a single data worksheet with dropdowns, plus hidden lists and instructions", async () => {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await buildGenericTemplate() as never);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([GENERIC_SHEET, "Catalogos", "Instrucciones"]);
    expect(workbook.getWorksheet(GENERIC_SHEET)!.getRow(1).values).toEqual([undefined, ...GENERIC_COLUMNS]);
    expect(workbook.getWorksheet(GENERIC_SHEET)!.getCell("J2").dataValidation.formulae).toEqual(['"INCLUIDO SIEMPRE,ELIGE UNO,OPCIONAL"']);
    expect(workbook.getWorksheet("Catalogos")!.state).toBe("hidden");
});

async function localizedPreview(file: Buffer, lng: string) {
    const i18n = require("i18next").createInstance(); await i18n.init({ lng, resources: { [lng]: { translation: require(`../../../locales/${lng}/translation.json`) } } });
    const { genericPackagingController } = require("../controllers/genericPackaging.controller");
    const json = jest.fn(), next = jest.fn();
    await genericPackagingController.preview({ file: { buffer: file }, t: i18n.t.bind(i18n) }, { json }, next);
    expect(next).not.toHaveBeenCalled();
    return { data: json.mock.calls[0][0].data, t: i18n.t.bind(i18n) };
}
it.each(["es", "en"])("preview and confirmation share localized row diagnostics with group and material context (%s)", async lng => {
    const file = await excel([[...configurationRow, "pallet", "Paletizado", "INCLUIDO SIEMPRE", "No existe", ""]]);
    const { data, t } = await localizedPreview(file, lng);
    expect(data.issues).toHaveLength(1);
    expect(data.issues[0]).toMatchObject({ sheet: GENERIC_SHEET, row: 2, field: "Material" });
    expect(data.issues[0].message).toContain("Paletizado"); expect(data.issues[0].message).toContain("No existe");
    expect(data.issues[0].message).not.toMatch(/errors\.|undefined/);
    const { genericPackagingController } = require("../controllers/genericPackaging.controller");
    const json = jest.fn(), status = jest.fn(), next = jest.fn(), res = { json, status }; status.mockReturnValue(res);
    await genericPackagingController.confirm({ file: { buffer: file }, body: { previewHash: data.previewHash }, t }, res, next);
    expect(status).toHaveBeenCalledWith(422);
    expect(json.mock.calls[0][0].details).toEqual(data.issues);
});
it("tarima, esquineros and stretch come from the pallet kit and are rejected inside a configuration", async () => {
    expect(await issueKeys([[...configurationRow, "pallet", "Paletizado", "INCLUIDO SIEMPRE", "Tarima del kit", ""]])).toEqual([[2, "Material", "errors.generic_packaging_import_pallet_kit"]]);
});
