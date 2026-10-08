import type { ParsedWorkbook } from "../../../shared/utils/parsedWorkbook"
import { resolvePalletConsumptionRule } from "../../packaging/services/packagingConsumption.service"
import ExcelJS from "exceljs"
import { createHash } from "node:crypto"
import { col, fn, Op, Transaction, where } from "sequelize"
import sequelize from "../../../database/connection"
import ProductVariant from "../models/ProductVariant.model"
import Product from "../models/Product.model"
import Packaging from "../../packaging/models/Packaging.model"
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model"
import ProductVariantUnitMaterial from "../models/ProductVariantUnitMaterial.model"
import ProductVariantIntermediateMaterial from "../models/ProductVariantIntermediateMaterial.model"
import ProductVariantPalletMaterial from "../models/ProductVariantPalletMaterial.model"
import { AppError, BulkImportError, RowIssue } from "../../../shared/errors/AppError"
import { isImportRowBlank, loadWorkbookFromBuffer, mapImportHeaders, normalizeImportText, readImportCell, writeWorkbookToBuffer } from "../../../shared/utils/excelImport.util"
import { optionGroupKey } from "../../../shared/utils/optionGroup.util"
import { materialGroupIdentity } from "../../../shared/utils/materialGroupIdentity.util"
import { skuCodeKey } from "./productSkuReference"
import { MAX_PRODUCT_PACKAGING_IMPORT_ROWS, PRODUCT_PACKAGING_IMPORT_COLUMNS } from "../constants/productPackagingImport.constant"

const validPositive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0

type Level = "unit" | "intermediate" | "pallet"
type Association = ProductVariantUnitMaterial | ProductVariantIntermediateMaterial | ProductVariantPalletMaterial
type Action = "new" | "update" | "unchanged" | "error"
export interface ParsedPackagingRow {
    row: number; skuCode: string; packagingCode: string; group: string
    isDefault: boolean; defaultSpecified: boolean; legacyRule: boolean; quantityBasis: string; quantity: number | null
    materialName: string; unitCost: number | null; issues: RowIssue[]
    materialType?: string; expectedRole?: Level
}
interface Values {
    productVariantId: number; packagingId: number; optionGroup: string | null
    optionGroupId?: number | null; isDefault: boolean; isActive: boolean
    quantityPerUnit?: number; quantityBasis?: "per_box" | "per_pallet"; quantityValue?: number
}
export interface PackagingImportPreviewRow {
    row: number; skuCode: string; packagingCode: string; materialName: string
    materialType?: string; level: string | null; group: string | null; isDefault: boolean
    quantityBasis: string | null; quantity: number | null; unitCost: number | null
    quantityPerPallet: number | null; ruleSource: "catalog" | "association" | "legacy" | "unit" | "variant" | null
    action: Action; previous: Partial<Values> | null; issues: RowIssue[]; warnings: RowIssue[]
}
export interface PlannedPackagingRow { preview: PackagingImportPreviewRow; values: Values | null; existing?: Association }
const groupIdentity = (row: { optionGroup: string | null; optionGroupId?: number | null }, level: Level) =>
    level === "intermediate" ? optionGroupKey(row.optionGroup) : materialGroupIdentity(row)
const associationValues = (row: Association, level: Level): Values => ({
    productVariantId: row.productVariantId, packagingId: row.packagingId,
    optionGroup: row.optionGroup, isDefault: row.isDefault, isActive: row.isActive,
    ...(level !== "intermediate" ? { optionGroupId: (row as ProductVariantUnitMaterial).optionGroupId ?? null } : {}),
    ...(level === "unit" ? { quantityPerUnit: Number((row as ProductVariantUnitMaterial).quantityPerUnit) } : {}),
    ...(level === "pallet" ? { quantityBasis: (row as ProductVariantPalletMaterial).quantityBasis, quantityValue: Number((row as ProductVariantPalletMaterial).quantityValue) } : {}),
})

async function parseFile(buffer: Buffer): Promise<ParsedPackagingRow[]> {
    if (!buffer.length) throw new AppError(422, "errors.bulk_import_empty_file")
    if (buffer.length > 5 * 1024 * 1024) throw new AppError(422, "errors.packaging_association_import.file_size")
    let workbook: ParsedWorkbook
    try { workbook = await loadWorkbookFromBuffer(buffer) }
    catch { throw new AppError(422, "errors.packaging_association_import.corrupt") }
    const sheet = workbook.worksheets[0]
    if (!sheet || sheet.rowCount <= 1) throw new AppError(422, "errors.bulk_import_empty_file")
    const columns = mapImportHeaders(sheet.getRow(1), PRODUCT_PACKAGING_IMPORT_COLUMNS)
    const missing = (["skuCode", "packagingCode"] as const).filter(field => !columns.has(field))
    if (missing.length) throw new AppError(422, "errors.bulk_import_missing_columns", { columns: missing.map(field => PRODUCT_PACKAGING_IMPORT_COLUMNS[field].header).join(", ") })
    // Duplicate recognized headers are ambiguous even if the values happen to match.
    const headers = new Set<string>()
    sheet.getRow(1).eachCell(cell => {
        if (typeof cell.value === "object" && cell.value && ("formula" in cell.value || "sharedFormula" in cell.value)) throw new AppError(422, "errors.packaging_association_import.formula")
        const header = normalizeImportText(typeof cell.value === "string" ? cell.value : null)
        const field = Object.entries(PRODUCT_PACKAGING_IMPORT_COLUMNS).find(([, def]) => def.aliases.includes(header))?.[0]
        if (field) {
            if (headers.has(field)) throw new AppError(422, "errors.packaging_association_import.duplicate_header")
            headers.add(field)
        }
    })
    if (sheet.rowCount - 1 > MAX_PRODUCT_PACKAGING_IMPORT_ROWS) throw new AppError(422, "errors.bulk_import_too_many_rows", { max: MAX_PRODUCT_PACKAGING_IMPORT_ROWS })
    const result: ParsedPackagingRow[] = []
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber)
        const issues: RowIssue[] = []
        // ExcelJS never evaluates formulas; reject them rather than trusting cached results.
        row.eachCell(cell => {
            if (typeof cell.value === "object" && cell.value && ("formula" in cell.value || "sharedFormula" in cell.value)) {
                issues.push({ row: rowNumber, field: "row", key: "errors.packaging_association_import.formula" })
            }
        })
        if (issues.length === 0 && isImportRowBlank(row, columns)) continue
        const text = (field: keyof typeof PRODUCT_PACKAGING_IMPORT_COLUMNS) => String(readImportCell(row, columns.get(field)) ?? "").trim()
        const defaultText = normalizeImportText(text("isDefault"))
        const trueValues = ["si", "yes", "true", "1"]
        const falseValues = ["", "no", "false", "0"]
        if (!trueValues.includes(defaultText) && !falseValues.includes(defaultText)) issues.push({ row: rowNumber, field: "isDefault", key: "errors.packaging_association_import.boolean" })
        if (text("group") && defaultText && !columns.has("quantityBasis") && !columns.has("quantity") && !["si", "yes", "no"].includes(defaultText) && !issues.some(issue => issue.field === "isDefault")) issues.push({ row: rowNumber, field: "isDefault", key: "errors.packaging_association_import.boolean" })
        const numeric = (field: "quantity" | "unitCost") => {
            const raw = text(field)
            if (!raw) return null
            const number = Number(raw)
            if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(number) || number < 0 || (field === "quantity" && number === 0)) issues.push({ row: rowNumber, field, key: "errors.packaging_association_import.number" })
            return Number.isFinite(number) ? number : null
        }
        result.push({ row: rowNumber, skuCode: text("skuCode"), packagingCode: text("packagingCode"), group: text("group"),
            isDefault: trueValues.includes(defaultText), defaultSpecified: defaultText !== "", legacyRule: columns.has("quantityBasis") || columns.has("quantity"), quantityBasis: text("quantityBasis").toLowerCase(), quantity: numeric("quantity"),
            materialName: text("materialName"), unitCost: numeric("unitCost"), issues })
    }
    if (!result.length) throw new AppError(422, "errors.bulk_import_empty_file")
    return result
}

export interface InitialPackagingContext {
    variants: { id: number; skuCode: string; productId: number; isActive: boolean; boxesPerPallet?: number | null; bagsPerBox?: number | null; unitsPerIntermediatePackage?: number | null }[]
    products: { id: number; isActive: boolean }[]
}

export async function buildPackagingAssociationPlan(parsed: ParsedPackagingRow[], transaction?: Transaction, initial?: InitialPackagingContext) {
    const codes = [...new Set(parsed.map(row => skuCodeKey(row.skuCode)))]
    const options = { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) }
    const variants = initial?.variants ?? await ProductVariant.findAll({ ...options, where: where(fn("lower", col("skuCode")), { [Op.in]: codes }) })
    const products = initial?.products ?? await Product.findAll({ ...options, where: { id: { [Op.in]: variants.map(row => row.productId) } } })
    const packagings = await Packaging.findAll({ ...options, where: where(fn("lower", col("code")), { [Op.in]: [...new Set(parsed.map(row => skuCodeKey(row.packagingCode)))] }) })
    // All catalog groups are small and needed to resolve labels and detect unavailable groups.
    const groups = await PackagingGroup.findAll(options)
    const associationOptions = { ...options, where: { productVariantId: { [Op.in]: variants.map(row => row.id) } } }
    const associations: Record<Level, Association[]> = initial ? { unit: [], intermediate: [], pallet: [] } : {
        unit: await ProductVariantUnitMaterial.findAll(associationOptions),
        intermediate: await ProductVariantIntermediateMaterial.findAll(associationOptions),
        pallet: await ProductVariantPalletMaterial.findAll(associationOptions),
    }
    const plan: PlannedPackagingRow[] = []
    const duplicates = new Map<string, PlannedPackagingRow[]>()
    for (const row of parsed) {
        const variant = variants.find(value => skuCodeKey(value.skuCode) === skuCodeKey(row.skuCode))
        const packagingMatches = packagings.filter(value => skuCodeKey(value.code) === skuCodeKey(row.packagingCode))
        const packaging = packagingMatches.length === 1 ? packagingMatches[0] : undefined
        const group = row.group ? groups.find(value => value.nameKey === optionGroupKey(row.group)) : null
        const preview: PackagingImportPreviewRow = { row: row.row, skuCode: row.skuCode, packagingCode: row.packagingCode,
            ...(row.materialType ? { materialType: row.materialType } : {}), materialName: packaging?.displayName ?? row.materialName, level: packaging?.packagingRole ?? null,
            group: group?.displayName ?? (row.group || null), isDefault: row.isDefault, quantityBasis: row.quantityBasis || null,
            quantity: row.quantity, unitCost: packaging?.unitCost == null ? null : Number(packaging.unitCost), action: "new", previous: null,
            quantityPerPallet: null, ruleSource: null, issues: [...row.issues], warnings: [] }
        const error = (field: string, key: string, params?: Record<string, unknown>) => preview.issues.push({ row: row.row, field, key: `errors.packaging_association_import.${key}`, params })
        if (!variant) error("skuCode", "unknown_sku", { code: row.skuCode })
        else {
            if (!variant.isActive) error("skuCode", "inactive_variant")
            if (!products.find(product => product.id === variant.productId)?.isActive) error("skuCode", "inactive_product")
            if (!validPositive(variant.boxesPerPallet) || !validPositive(variant.bagsPerBox)) error("skuCode", "pallet_configuration")
        }
        if (packagingMatches.length > 1) error("packagingCode", "ambiguous_packaging", { code: row.packagingCode })
        else if (!packaging) error("packagingCode", "unknown_packaging", { code: row.packagingCode })
        else if (!packaging.isActive) error("packagingCode", "inactive_packaging")
        if (row.group && !row.defaultSpecified) error("isDefault", "default_required")
        if (row.group && !group) error("group", "unknown_group", { group: row.group })
        if (group && !group.isActive) error("group", "inactive_group", { group: group.displayName })
        if (!row.group && row.isDefault) error("isDefault", "fixed_default")
        const level = packaging?.packagingRole as Level | undefined
        if (row.expectedRole && packaging && level !== row.expectedRole) error("materialType", "type_role", { type: row.materialType, role: level })
        if (initial && packaging?.packagingRole === "pallet" && (packaging.defaultQuantityBasis != null || packaging.defaultQuantityValue != null)) {
            try {
                const defaults = resolvePalletConsumptionRule(packaging)
                if (defaults.quantityBasis !== row.quantityBasis || defaults.quantityValue !== row.quantity) error("materialType", "catalog_conflict", { code: packaging.code })
            } catch { error("materialType", "catalog_conflict", { code: packaging.code }) }
        }
        let values: Values | null = null
        let existing: Association | undefined
        if (variant && packaging && ["unit", "intermediate", "pallet"].includes(level ?? "")) {
            if ((["unit", "intermediate", "pallet"] as const).some(otherLevel => otherLevel !== level && associations[otherLevel].some(value => value.productVariantId === variant.id && value.packagingId === packaging.id && value.isActive))) error("level", "existing_role", { role: level })
            existing = associations[level!].find(value => value.productVariantId === variant.id && value.packagingId === packaging.id)
            values = { productVariantId: variant.id, packagingId: packaging.id, optionGroup: group?.displayName ?? null, isDefault: row.isDefault, isActive: true }
            if (level !== "intermediate") values.optionGroupId = group?.id ?? null
            if (level === "unit") {
                if ((row.quantity !== null && row.quantity !== 1) || (row.quantityBasis && row.quantityBasis !== "per_unit")) error("quantity", "unit_rule")
                values.quantityPerUnit = row.quantity === null && !row.quantityBasis && existing ? Number((existing as ProductVariantUnitMaterial).quantityPerUnit) : 1
                preview.quantity = values.quantityPerUnit; preview.quantityBasis = "per_unit"
                preview.ruleSource = existing && row.quantity === null && !row.quantityBasis ? "association" : "unit"
            } else if (level === "intermediate") {
                if (!validPositive(variant.unitsPerIntermediatePackage)) error("quantity", "intermediate_configuration")
                if (row.quantity !== null || row.quantityBasis) error("quantity", "intermediate_rule")
                preview.quantity = null; preview.quantityBasis = null; preview.ruleSource = "variant"
            } else {
                const explicit = row.legacyRule
                preview.ruleSource = explicit ? "legacy" : existing ? "association" : "catalog"
                try {
                    const rule = resolvePalletConsumptionRule(packaging,
                        explicit ? { quantityBasis: row.quantityBasis, quantityValue: row.quantity } : undefined,
                        existing ? { quantityBasis: (existing as ProductVariantPalletMaterial).quantityBasis, quantityValue: Number((existing as ProductVariantPalletMaterial).quantityValue) } : undefined)
                    values.quantityBasis = rule.quantityBasis; values.quantityValue = rule.quantityValue
                    preview.quantityBasis = rule.quantityBasis; preview.quantity = rule.quantityValue
                    preview.quantityPerPallet = rule.quantityBasis === "per_box" ? (validPositive(variant.boxesPerPallet) ? rule.quantityValue * Number(variant.boxesPerPallet) : null) : rule.quantityValue
                    if (rule.quantityBasis === "per_box" && !validPositive(variant.boxesPerPallet)) error("quantityBasis", "boxes_required")
                } catch {
                    if (!explicit) error("packagingCode", "missing_consumption", { code: packaging.code })
                    else {
                        if (!["per_box", "per_pallet"].includes(row.quantityBasis)) error("quantityBasis", "pallet_basis")
                        if (row.quantity === null || row.quantity <= 0 || row.quantity > 99999999.99 || Math.abs(row.quantity * 100 - Math.round(row.quantity * 100)) > 0.000001) error("quantity", "pallet_quantity")
                    }
                }
            }
            if (existing) {
                preview.previous = associationValues(existing, level!)
                preview.action = JSON.stringify(preview.previous) === JSON.stringify(values) ? "unchanged" : "update"
            }
        } else if (packaging) error("level", "invalid_role")
        if (packaging && row.materialName && row.materialName !== packaging.displayName) preview.warnings.push({ row: row.row, field: "materialName", key: "errors.packaging_association_import.name_warning", params: { excel: row.materialName, catalog: packaging.displayName } })
        if (packaging && row.unitCost !== null && (packaging.unitCost == null || row.unitCost !== Number(packaging.unitCost))) preview.warnings.push({ row: row.row, field: "unitCost", key: "errors.packaging_association_import.cost_warning", params: { excel: row.unitCost, catalog: preview.unitCost ?? "—" } })
        const planned = { preview, values, existing }
        plan.push(planned)
        const duplicateKey = JSON.stringify([skuCodeKey(row.skuCode), skuCodeKey(row.packagingCode)])
        duplicates.set(duplicateKey, [...(duplicates.get(duplicateKey) ?? []), planned])
    }
    for (const rows of duplicates.values()) if (rows.length > 1) for (const row of rows) row.preview.issues.push({ row: row.preview.row, field: "packagingCode", key: "errors.packaging_association_import.duplicate", params: { rows: rows.map(value => value.preview.row).join(", ") } })

    // Validate the FINAL state, including untouched active siblings and groups being left.
    // Importing never auto-demotes defaults: every change must appear in the preview.
    for (const level of ["unit", "intermediate", "pallet"] as const) {
        for (const variant of variants) {
            const imported = plan.filter(row => row.values?.productVariantId === variant.id && row.preview.level === level)
            const finalRows = associations[level].filter(row => row.productVariantId === variant.id && row.isActive && !imported.some(candidate => candidate.values?.packagingId === row.packagingId)).map(row => associationValues(row, level))
            finalRows.push(...imported.flatMap(row => row.values ? [row.values] : []))
            const grouped = new Map<string, Values[]>()
            for (const row of finalRows) {
                const identity = groupIdentity(row, level)
                if (identity !== null) grouped.set(identity, [...(grouped.get(identity) ?? []), row])
            }
            for (const [identity, siblings] of grouped) {
                const touched = imported.filter(row => (row.values && groupIdentity(row.values, level) === identity) || (row.existing && groupIdentity(row.existing, level) === identity))
                if (!touched.length) continue
                const keys: string[] = []
                if (siblings.filter(row => row.isDefault).length !== 1) keys.push("defaults")
                if (level === "pallet" && siblings.some(row => row.quantityBasis !== siblings[0].quantityBasis || row.quantityValue !== siblings[0].quantityValue)) keys.push("group_quantity")
                for (const row of touched) for (const key of keys) row.preview.issues.push({ row: row.preview.row, field: "group", key: `errors.packaging_association_import.${key}`, params: { group: siblings[0].optionGroup, rows: touched.map(value => value.preview.row).join(", ") } })
            }
        }
    }
    if (initial) {
        const grouped = new Map<string, PlannedPackagingRow[]>()
        for (const row of plan) if (row.preview.group) {
            const identity = JSON.stringify([skuCodeKey(row.preview.skuCode), optionGroupKey(row.preview.group)])
            grouped.set(identity, [...(grouped.get(identity) ?? []), row])
        }
        for (const siblings of grouped.values()) if (new Set(siblings.map(row => row.preview.level)).size > 1) {
            for (const row of siblings) row.preview.issues.push({ row: row.preview.row, field: "group", key: "errors.packaging_association_import.group_role" })
        }
    }
    for (const row of plan) if (row.preview.issues.length) row.preview.action = "error"
    const summary = { total: plan.length, new: 0, update: 0, unchanged: 0, error: 0 }
    for (const row of plan) summary[row.preview.action]++
    // Bind approval to the full relevant DB state, not just uploaded data. Revalidate in
    // SERIALIZABLE isolation at confirmation; concurrent edits require a new preview.
    const state = {
        variants: variants.map(row => [row.id, row.skuCode, row.isActive, row.productId, row.boxesPerPallet, row.bagsPerBox, row.unitsPerIntermediatePackage]).sort(),
        products: products.map(row => [row.id, row.isActive]).sort(),
        packagings: packagings.map(row => [row.id, row.code, row.isActive, row.packagingRole, row.unitCost, row.displayName, row.defaultQuantityBasis ?? null, row.defaultQuantityValue == null ? null : Number(row.defaultQuantityValue)]).sort(),
        groups: groups.map(row => [row.id, row.isActive, row.nameKey, row.displayName]).sort(),
        associations: Object.fromEntries(Object.entries(associations).map(([level, rows]) => [level, rows.map(row => [row.id, associationValues(row, level as Level)]).sort()])),
    }
    const previewHash = createHash("sha256").update(JSON.stringify({ parsed, state })).digest("hex")
    return { plan, previewHash, summary }
}

export async function writePackagingAssociationPlan(plan: PlannedPackagingRow[], transaction: Transaction, variantIds?: Map<number, number>): Promise<void> {
    for (const row of plan) {
        if (!row.values || row.preview.action === "unchanged") continue
        if (row.preview.issues.length) throw new BulkImportError(row.preview.issues)
        const productVariantId = variantIds ? variantIds.get(row.values.productVariantId) : row.values.productVariantId
        if (productVariantId == null) throw new AppError(422, "errors.packaging_association_import.unknown_sku", { code: row.preview.skuCode })
        const values = { ...row.values, productVariantId }
        if (row.existing) await row.existing.update(values, { transaction })
        else if (row.preview.level === "unit") await ProductVariantUnitMaterial.create(values, { transaction })
        else if (row.preview.level === "intermediate") await ProductVariantIntermediateMaterial.create(values, { transaction })
        else await ProductVariantPalletMaterial.create(values, { transaction })
    }
}

async function previewProductPackagingImport(buffer: Buffer) {
    const result = await buildPackagingAssociationPlan(await parseFile(buffer))
    return { previewHash: result.previewHash, summary: result.summary, rows: result.plan.map(row => row.preview) }
}

async function confirmProductPackagingImport(buffer: Buffer, previewHash: string) {
    if (!/^[a-f0-9]{64}$/.test(previewHash)) throw new AppError(422, "errors.packaging_association_import.preview_required")
    const parsed = await parseFile(buffer)
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async transaction => {
        const result = await buildPackagingAssociationPlan(parsed, transaction)
        if (result.summary.error) throw new BulkImportError(result.plan.flatMap(row => row.preview.issues))
        if (result.previewHash !== previewHash) throw new AppError(409, "errors.packaging_association_import.stale_preview")
        await writePackagingAssociationPlan(result.plan, transaction)
        return result.summary
    })
}

async function buildProductPackagingImportTemplate(instructions: string[] = []): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Materiales por variante")
    sheet.columns = Object.entries(PRODUCT_PACKAGING_IMPORT_COLUMNS).slice(0, 4).map(([key, column]) => ({ header: column.header, key, width: 26 }))
    sheet.getRow(1).font = { bold: true }
    sheet.getColumn("skuCode").numFmt = "@"; sheet.getColumn("packagingCode").numFmt = "@"
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    for (let row = 2; row <= MAX_PRODUCT_PACKAGING_IMPORT_ROWS + 1; row++) {
        sheet.getCell(row, 4).dataValidation = { type: "list", allowBlank: true, formulae: ['"SI,NO"'] }
    }
    const help = workbook.addWorksheet("Instrucciones")
    help.columns = [{ header: "Instrucciones / Instructions", key: "text", width: 120 }]
    instructions.forEach(text => help.addRow({ text }))
    const catalog = workbook.addWorksheet("Grupos")
    catalog.columns = [{ header: "GRUPO DE OPCIONES", key: "name", width: 60 }]
    const groups = await PackagingGroup.findAll({ where: { isActive: true }, order: [["displayName", "ASC"]] })
    for (const group of groups) catalog.addRow({ name: group.displayName })
    if (groups.length) {
        workbook.definedNames.add(`'Grupos'!$A$2:$A$${groups.length + 1}`, "PackagingImportGroups")
        for (let row = 2; row <= MAX_PRODUCT_PACKAGING_IMPORT_ROWS + 1; row++) sheet.getCell(row, 3).dataValidation = { type: "list", allowBlank: true, formulae: ["PackagingImportGroups"] }
    }
    return writeWorkbookToBuffer(workbook)
}

export const productPackagingImportService = { previewProductPackagingImport, confirmProductPackagingImport, buildProductPackagingImportTemplate }
