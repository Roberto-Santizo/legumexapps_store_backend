import type { ParsedWorksheet } from "../../../shared/utils/parsedWorkbook"
import { AppError, RowIssue } from "../../../shared/errors/AppError"
import { isImportRowBlank, mapImportHeaders, normalizeImportText, readImportCell } from "../../../shared/utils/excelImport.util"
import { MAX_PRODUCT_PACKAGING_IMPORT_ROWS } from "../constants/productPackagingImport.constant"
import { INITIAL_PACKAGING_COLUMNS as columns, INITIAL_MATERIAL_TYPES as types } from "../constants/initialPackagingImport.constant"
import type { ParsedPackagingRow } from "./productPackagingImport.service"

export function parseInitialPackagingSheet(sheet?: ParsedWorksheet): ParsedPackagingRow[] {
    if (!sheet) return []
    const mapped = mapImportHeaders(sheet.getRow(1), columns)
    const missing = Object.keys(columns).filter(key => !mapped.has(key as keyof typeof columns))
    if (missing.length) throw new AppError(422, "errors.bulk_import_missing_columns", { columns: missing.map(key => columns[key as keyof typeof columns].header).join(", ") })
    const recognized = new Set<string>()
    sheet.getRow(1).eachCell(cell => {
        const header = normalizeImportText(String(cell.value ?? ""))
        const key = Object.entries(columns).find(([, def]) => (def.aliases as readonly string[]).includes(header))?.[0]
        if (key && recognized.has(key)) throw new AppError(422, "errors.packaging_association_import.duplicate_header")
        if (key) recognized.add(key)
        if (typeof cell.value === "object" && cell.value && ("formula" in cell.value || "sharedFormula" in cell.value)) throw new AppError(422, "errors.packaging_association_import.formula")
    })
    if (sheet.rowCount - 1 > MAX_PRODUCT_PACKAGING_IMPORT_ROWS) throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PRODUCT_PACKAGING_IMPORT_ROWS })
    const rows: ParsedPackagingRow[] = []
    for (let number = 2; number <= sheet.rowCount; number++) {
        const row = sheet.getRow(number)
        const issues: RowIssue[] = []
        const error = (field: string, key: string) => issues.push({ row: number, field, key: `errors.packaging_association_import.${key}` })
        row.eachCell(cell => {
            if (typeof cell.value === "object" && cell.value && ("formula" in cell.value || "sharedFormula" in cell.value)) error("row", "formula")
        })
        if (!issues.length && isImportRowBlank(row, mapped)) continue
        const text = (key: keyof typeof columns) => String(readImportCell(row, mapped.get(key)) ?? "").trim()
        const type = Object.keys(types).find(key => normalizeImportText(key) === normalizeImportText(text("materialType"))) as keyof typeof types | undefined
        const rule = type ? types[type] : undefined
        if (!rule) error("materialType", "unknown_type")
        const defaultText = normalizeImportText(text("isDefault"))
        if (defaultText && !["si", "yes", "no"].includes(defaultText)) error("isDefault", "boolean")
        const rawQuantity = text("quantity")
        const quantity = rawQuantity ? Number(rawQuantity) : null
        if (rawQuantity && (!/^\d+(?:\.\d+)?$/.test(rawQuantity) || !Number.isFinite(quantity) || !(Number(quantity) > 0))) error("quantity", "number")
        const forms: Record<string, string> = { "por caja": "per_box", "por pallet": "per_pallet" }
        const rawBasis = text("basis")
        const basis = rawBasis ? forms[normalizeImportText(rawBasis)] : ""
        if (rawBasis && !basis) error("basis", "friendly_basis")
        const other = type === "OTRO PALETIZACIÓN"
        if (rule && !other) {
            if (rawBasis && basis !== rule.basis) error("basis", "type_rule")
            if (rawQuantity && quantity !== rule.quantity) error("quantity", "type_rule")
        }
        if (other && (!rawBasis || !rawQuantity)) error("quantity", "other_rule_required")
        rows.push({ row: number, skuCode: text("skuCode"), packagingCode: text("packagingCode"), materialName: "", unitCost: null,
            materialType: type ?? text("materialType"), expectedRole: rule?.role,
            group: text("group"), isDefault: ["si", "yes"].includes(defaultText), defaultSpecified: !!defaultText,
            legacyRule: true, quantityBasis: other ? basis ?? "" : rule?.basis ?? "",
            quantity: other ? quantity : rule?.quantity ?? null, issues })
    }
    return rows
}
