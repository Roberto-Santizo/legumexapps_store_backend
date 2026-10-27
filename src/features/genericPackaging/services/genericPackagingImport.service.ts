import { addImportValidation } from "../../../shared/utils/excelImport.util"
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { Transaction } from "sequelize";
import sequelize from "../../../database/connection";
import Profile from "../models/GenericPackagingConfiguration.model";
import { AppError, BulkImportError, type RowIssue } from "../../../shared/errors/AppError";
import { loadWorkbookFromBuffer, normalizeImportText, writeWorkbookToBuffer, validateXlsxBuffer } from "../../../shared/utils/excelImport.util";
import { genericConfigurationSchema, type GenericConfigurationInput } from "../schemas/genericPackaging.schema";
import { genericCatalogOptions, saveGenericProfile } from "./genericPackaging.service";
import { validateGenericProfile, type GenericProfile } from "./genericPackagingResolver";
import { isPalletKitType } from "../../packaging/constants/packagingMaterialType.constant";

// One worksheet, one row per material. Rows sharing a reference form one configuration; its data goes on the first row.
export const GENERIC_SHEET = "Configuraciones";
export const GENERIC_COLUMNS = ["Referencia", "Nombre", "Categoría", "Presentación", "Unidades por caja", "Cajas por pallet", "Unidades por intermedio", "Nivel", "Grupo", "Uso", "Material", "Cantidad"] as const;
const MAX_ROWS = 2000;
// Nombre..Cajas por pallet are required on the first row; Unidades por intermedio is optional.
const CONFIGURATION_COLUMNS = [1, 2, 3, 4, 5, 6] as const;
const REQUIRED_CONFIGURATION_COLUMNS = [1, 2, 3, 4, 5] as const;
const LEVELS: Record<string, "unit" | "intermediate" | "pallet"> = { individual: "unit", unit: "unit", intermedio: "intermediate", intermediate: "intermediate", pallet: "pallet", paletizacion: "pallet" };
const USAGES: Record<string, { selectionMode: "one" | "all"; isRequired: boolean }> = {
    "incluido siempre": { selectionMode: "all", isRequired: true }, "always included": { selectionMode: "all", isRequired: true },
    "elige uno": { selectionMode: "one", isRequired: true }, "choose one": { selectionMode: "one", isRequired: true },
    opcional: { selectionMode: "one", isRequired: false }, optional: { selectionMode: "one", isRequired: false },
};
const key = (value: unknown) => normalizeImportText(String(value ?? ""));
type Row = { row: number; values: string[]; skipped?: boolean };
type Catalogs = Awaited<ReturnType<typeof genericCatalogOptions>>;
type PlannedProfile = { row: number; input: GenericConfigurationInput };

function readRows(workbook: ExcelJS.Workbook, issue: (row: number, field: string, detail: string) => void): Row[] {
    const sheet = workbook.getWorksheet(GENERIC_SHEET);
    if (!sheet) { issue(1, "sheet", "errors.generic_packaging_import_0"); return []; }
    const columns = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, col) => {
        const header = key(cell.value);
        if (columns.has(header)) issue(1, GENERIC_COLUMNS.find(label => key(label) === header) ?? String(cell.value ?? ""), "errors.generic_packaging_import_1");
        columns.set(header, col);
    });
    const missing = GENERIC_COLUMNS.filter(header => !columns.has(key(header)));
    missing.forEach(header => issue(1, header, "errors.generic_packaging_import_2"));
    if (missing.length) return [];
    if (sheet.rowCount > MAX_ROWS + 1) { issue(1, "sheet", "errors.generic_packaging_import_3"); return []; }
    const rows: Row[] = [];
    for (let n = 2; n <= sheet.rowCount; n++) {
        const row = sheet.getRow(n);
        let formula = false;
        row.eachCell(cell => { if (cell.value && typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value)) formula = true; });
        const values = GENERIC_COLUMNS.map(header => row.getCell(columns.get(key(header))!).text.trim());
        // A row with formulas is reported and skipped, but still carries its Referencia for the rows below.
        if (formula) { issue(n, "row", "errors.generic_packaging_import_4"); rows.push({ row: n, values, skipped: true }); continue; }
        if (values.some(Boolean)) rows.push({ row: n, values });
    }
    return rows;
}

const uniqueByName = <T>(items: T[], value: string, ...labels: ((item: T) => unknown)[]) => {
    const found = items.filter(item => labels.some(label => key(label(item)) === key(value)));
    return found.length === 1 ? found[0] : undefined;
};

function planConfiguration(reference: string, rows: Row[], catalogs: Catalogs, issue: (row: number, field: string, detail: string, group?: string, material?: string) => void): PlannedProfile | undefined {
    const [first] = rows, v = first.values;
    let failures = 0;
    const fail = (row: number, field: string, detail: string, group?: string, material?: string) => { failures++; issue(row, field, detail, group, material); };
    for (const column of REQUIRED_CONFIGURATION_COLUMNS) if (!v[column]) fail(first.row, GENERIC_COLUMNS[column], "errors.generic_packaging_import_first_row");
    // Configuration data lives on the first row; later rows may leave it empty or repeat it exactly.
    for (const { row, values } of rows.slice(1)) for (const column of CONFIGURATION_COLUMNS)
        if (values[column] && key(values[column]) !== key(v[column])) fail(row, GENERIC_COLUMNS[column], "errors.generic_packaging_import_mismatch");
    const category = uniqueByName(catalogs.categories, v[2], item => item.displayName);
    const presentation = uniqueByName(catalogs.presentations, v[3], item => item.displayLabel);
    if (v[2] && !category) fail(first.row, "Categoría", "errors.generic_packaging_import_invalid");
    if (v[3] && !presentation) fail(first.row, "Presentación", "errors.generic_packaging_import_invalid");
    type PlannedGroup = GenericConfigurationInput["groups"][number] & { rows: Row[] };
    const groups = new Map<string, PlannedGroup>();
    for (const entry of rows) {
        const { row, values } = entry;
        const level = LEVELS[key(values[7])], group = uniqueByName(catalogs.groups, values[8], item => item.displayName), usage = USAGES[key(values[9])];
        if (!level) { fail(row, "Nivel", "errors.generic_packaging_import_invalid", values[8], values[10]); continue; }
        if (!group) { fail(row, "Grupo", "errors.generic_packaging_import_invalid", values[8], values[10]); continue; }
        if (!usage) { fail(row, "Uso", "errors.generic_packaging_import_usage", values[8], values[10]); continue; }
        const groupKey = `${level}:${group.id}`;
        // The first row naming a group sets its use, even if that row's material has its own error.
        if (!groups.has(groupKey)) groups.set(groupKey, { packagingGroupId: group.id!, level, ...usage, options: [], rows: [] });
        const current = groups.get(groupKey)!;
        if (current.selectionMode !== usage.selectionMode || current.isRequired !== usage.isRequired) { fail(row, "Uso", "errors.generic_packaging_import_usage", values[8], values[10]); continue; }
        const candidates = catalogs.materials.filter(material => material.packagingRole === level && (key(material.displayName) === key(values[10]) || key(material.code) === key(values[10]) || String(material.id) === values[10]));
        if (candidates.length !== 1) { fail(row, "Material", candidates.length ? "errors.generic_packaging_import_material_ambiguous" : "errors.generic_packaging_import_material_unknown", values[8], values[10]); continue; }
        const material = candidates[0], quantity = values[11];
        if (isPalletKitType(material.materialType)) { fail(row, "Material", "errors.generic_packaging_import_pallet_kit", values[8], values[10]); continue; }
        if (level === "intermediate") {
            if (quantity) { fail(row, "Cantidad", "errors.generic_packaging_import_quantity", values[8], values[10]); continue; }
            current.options.push({ packagingId: material.id!, quantityBasis: "per_intermediate", quantityValue: null });
        } else if (level === "unit") {
            current.options.push({ packagingId: material.id!, quantityBasis: "per_unit", quantityValue: quantity ? Number(quantity) : 1 });
        } else {
            // Pallet consumption comes from the catalog (corner boards 4, pallet 1, stretch 93.3); Cantidad only overrides the amount.
            if (!material.defaultQuantityBasis || material.defaultQuantityValue == null) { fail(row, "Material", "errors.generic_packaging_import_no_consumption", values[8], values[10]); continue; }
            current.options.push({ packagingId: material.id!, quantityBasis: material.defaultQuantityBasis, quantityValue: quantity ? Number(quantity) : Number(material.defaultQuantityValue) });
        }
        current.rows.push(entry);
    }
    if ([...groups.values()].some(group => group.level === "intermediate") && !v[6]) fail(first.row, "Unidades por intermedio", "errors.generic_packaging_import_first_row");
    if (failures) return undefined;
    const groupList = [...groups.values()];
    const candidate = { reference, displayName: v[1], categoryId: category!.id!, presentationId: presentation!.id!, bagsPerBox: Number(v[4]), boxesPerPallet: Number(v[5]), unitsPerIntermediatePackage: v[6] ? Number(v[6]) : null, isActive: true,
        groups: groupList.map(({ rows: _rows, ...group }) => group) };
    const result = genericConfigurationSchema.safeParse(candidate);
    if (!result.success) {
        for (const problem of result.error.issues) {
            const group = typeof problem.path[1] === "number" ? groupList[problem.path[1]] : undefined;
            const source = group?.rows[typeof problem.path[3] === "number" ? problem.path[3] : 0];
            const labels: Record<string, string> = { displayName: "Nombre", bagsPerBox: "Unidades por caja", boxesPerPallet: "Cajas por pallet", unitsPerIntermediatePackage: "Unidades por intermedio", packagingId: "Material", quantityValue: "Cantidad", quantityBasis: "Cantidad" };
            const field = labels[String(problem.path.at(-1))] ?? (source ? "Material" : "Referencia");
            fail(source?.row ?? first.row, field, problem.message.startsWith("errors.") ? problem.message : "errors.generic_packaging_import_invalid", source?.values[8], source?.values[10]);
        }
        return undefined;
    }
    const profile = { ...result.data, id: first.row, presentation: catalogs.presentations.find(item => item.id === presentation!.id)!.toJSON(),
        groups: result.data.groups.map((group, i) => ({ ...group, id: i + 1, isActive: true, group: catalogs.groups.find(item => item.id === group.packagingGroupId)!.toJSON(),
            options: group.options.map((option, j) => ({ ...option, id: j + 1, isActive: true, packaging: catalogs.materials.find(item => item.id === option.packagingId)!.toJSON() })) })) };
    try {
        validateGenericProfile(profile as unknown as GenericProfile);
    } catch (cause) {
        const group = cause instanceof AppError && typeof cause.params?.groupId === "number" ? groupList[cause.params.groupId - 1] : undefined;
        fail(group?.rows[0].row ?? first.row, group ? "Grupo" : "Referencia", cause instanceof AppError ? cause.key : "errors.generic_packaging_import_invalid", group?.rows[0].values[8]);
        return undefined;
    }
    return { row: first.row, input: result.data };
}

export async function planGenericImport(buffer: Buffer, transaction?: Transaction) {
    validateXlsxBuffer(buffer);
    const workbook = await loadWorkbookFromBuffer(buffer);
    const catalogs = await genericCatalogOptions(transaction);
    const existing = new Set((await Profile.findAll({ transaction, attributes: ["reference"] })).map(profile => key(profile.reference)));
    const issues: RowIssue[] = [];
    const issue = (row: number, field: string, detail: string, group?: string, material?: string) => {
        if (issues.some(item => item.row === row && (item.field === field || item.field === "row"))) return;
        issues.push({ sheet: GENERIC_SHEET, row, field, key: detail, params: { field, ...(group ? { group } : {}), ...(material ? { material } : {}) } });
    };
    const rows = readRows(workbook, issue);
    // An empty Referencia continues the configuration of the rows above it.
    const byReference = new Map<string, Row[]>();
    const blocked = new Set<string>();
    let current = "";
    for (const entry of rows) {
        current = entry.values[0] || current;
        // A configuration with a formula row already has its primary error; do not add dependent ones.
        if (entry.skipped) { blocked.add(key(current)); continue; }
        if (!current) { issue(entry.row, "Referencia", "errors.generic_packaging_import_reference"); continue; }
        byReference.set(key(current), [...(byReference.get(key(current)) ?? []), { ...entry, values: [current, ...entry.values.slice(1)] }]);
    }
    const profiles: PlannedProfile[] = [];
    for (const [referenceKey, group] of byReference) {
        if (blocked.has(referenceKey)) continue;
        if (existing.has(referenceKey)) { issue(group[0].row, "Referencia", "errors.generic_packaging_import_reference"); continue; }
        const planned = planConfiguration(group[0].values[0], group, catalogs, issue);
        if (planned) profiles.push(planned);
    }
    if (!rows.some(entry => !entry.skipped) && !issues.length) issue(2, "row", "errors.generic_packaging_import_13");
    const previewHash = createHash("sha256").update(buffer).update(JSON.stringify({ profiles, catalogs, existing: [...existing].sort() })).digest("hex");
    return { profiles, issues, previewHash, summary: { configurations: profiles.length, errors: issues.length } };
}

export async function confirmGenericImport(buffer: Buffer, previewHash: string) {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async (transaction) => {
        await sequelize.query("SELECT pg_advisory_xact_lock(174226, 3)", { transaction });
        const plan = await planGenericImport(buffer, transaction);
        if (plan.previewHash !== previewHash) throw new AppError(409, "errors.generic_packaging_changed");
        if (plan.issues.length) throw new BulkImportError(plan.issues);
        for (const profile of plan.profiles) await saveGenericProfile(profile.input, undefined, transaction);
        return plan.summary;
    });
}

export async function buildGenericTemplate() {
    const workbook = new ExcelJS.Workbook(), catalogs = await genericCatalogOptions();
    const sheet = workbook.addWorksheet(GENERIC_SHEET);
    sheet.addRow([...GENERIC_COLUMNS]);
    sheet.columns.forEach(column => { column.width = 22; });
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24543B" } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: GENERIC_COLUMNS.length } };
    const lists = workbook.addWorksheet("Catalogos");
    lists.state = "hidden";
    const values = [catalogs.categories.map(item => item.displayName), catalogs.presentations.map(item => item.displayLabel), catalogs.groups.map(item => item.displayName), catalogs.materials.map(item => item.displayName)];
    values.forEach((column, i) => {
        column.forEach((value, j) => { lists.getCell(j + 1, i + 1).value = value; });
        const letter = lists.getColumn(i + 1).letter;
        workbook.definedNames.add(`'Catalogos'!$${letter}$1:$${letter}$${Math.max(column.length, 1)}`, ["GenericCategories", "GenericPresentations", "GenericGroups", "GenericMaterials"][i]);
    });
    const validations: [number, string][] = [[3, "GenericCategories"], [4, "GenericPresentations"], [8, '"individual,intermedio,pallet"'], [9, "GenericGroups"], [10, '"INCLUIDO SIEMPRE,ELIGE UNO,OPCIONAL"'], [11, "GenericMaterials"]];
    for (const [column, formula] of validations) addImportValidation(sheet, `${sheet.getColumn(column).letter}2:${sheet.getColumn(column).letter}${MAX_ROWS + 1}`, { type: "list", allowBlank: true, formulae: [formula], showErrorMessage: column !== 11, errorStyle: "stop" });
    const help = workbook.addWorksheet("Instrucciones");
    help.getColumn(1).width = 140;
    for (const text of [
        "Una fila por material. Las filas con la misma Referencia (o con Referencia vacía debajo de ella) forman una configuración; sus datos (Nombre a Unidades por intermedio) van solo en la primera fila.",
        "Los materiales deben existir en Empaques como genéricos y activos (créelos antes con la carga masiva de Empaques). Escriba su nombre o código.",
        "Uso: INCLUIDO SIEMPRE (se suma solo), ELIGE UNO (el representante elige una alternativa) u OPCIONAL.",
        "No agregue tarima, esquineros ni stretch: el kit de paletizado (marcado en Empaques) se suma solo a cada cotización de productos nuevos.",
        "Cantidad es opcional: individual = 1 por unidad; pallet = consumo del catálogo (caja 1 por caja); intermedio: déjela vacía.",
        "Solo crea configuraciones nuevas: una Referencia que ya existe se rechaza. Se valida todo antes de guardar; confirme la vista previa. No se aceptan fórmulas.",
        "",
        "Ejemplo:",
        "CFG-2LB | Bolsa 2 lb x12 | [categoría] | [presentación] | 12 | 60 | | individual | Bolsa | ELIGE UNO | Bolsa genérica con zipper |",
        "CFG-2LB | | | | | | | individual | Bolsa | ELIGE UNO | Bolsa genérica sin zipper |",
        "CFG-2LB | | | | | | | pallet | Caja | ELIGE UNO | Caja de transporte |",
        "",
        "Materiales genéricos disponibles: nombre | código | nivel",
        ...catalogs.materials.map(material => `${material.displayName} | ${material.code} | ${material.packagingRole}`),
    ]) help.addRow([text]);
    return writeWorkbookToBuffer(workbook);
}
