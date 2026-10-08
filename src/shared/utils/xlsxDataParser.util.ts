import { posix } from "node:path"
import { SaxesParser, SaxesTagNS } from "saxes"
import type { ParsedDataValue, ParsedSheetData, ParsedWorkbookData } from "./parsedWorkbook"
import { XLSX_READ_LIMITS as limits } from "./xlsxArchive.util"

const MAIN = new Set(["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"])
const DOCUMENT_RELS = new Set(["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"])
const PACKAGE_RELS = new Set(["http://schemas.openxmlformats.org/package/2006/relationships", "http://purl.oclc.org/ooxml/package/relationships"])
const CONTENT_TYPES = new Set(["http://schemas.openxmlformats.org/package/2006/content-types"])
type XmlHandlers = {
    open?: (tag: SaxesTagNS, path: string[]) => void
    text?: (text: string, path: string[]) => void
    close?: (tag: SaxesTagNS, path: string[]) => void
}

function requireData(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(`Invalid XLSX data: ${message}`)
}
function attribute(tag: SaxesTagNS, name: string, namespaces?: Set<string>): string | undefined {
    return Object.values(tag.attributes).find(attr => attr.local === name && (namespaces ? namespaces.has(attr.uri) : !attr.uri))?.value
}
function xmlText(data: Buffer): string {
    const encoding = data[0] === 0xff && data[1] === 0xfe ? "utf-16le" : data[0] === 0xfe && data[1] === 0xff ? "utf-16be" : "utf-8"
    return new TextDecoder(encoding, { fatal: true }).decode(data)
}
function parseXml(data: Buffer | undefined, root: string, namespaces: Set<string>, handlers: XmlHandlers): void {
    requireData(Boolean(data?.length), `missing or empty ${root} XML`)
    const parser = new SaxesParser({ xmlns: true })
    const stack: SaxesTagNS[] = []
    let rootSeen = false
    let nodes = 0
    parser.on("doctype", () => { throw new Error("XLSX XML DTDs are not supported") })
    parser.on("opentag", tag => {
        if (!stack.length) {
            requireData(tag.local === root && namespaces.has(tag.uri), `unexpected ${root} root`)
            rootSeen = true
        }
        stack.push(tag)
        requireData(stack.length <= 64 && Object.keys(tag.attributes).length <= 128 && ++nodes <= 4000000, "XML complexity limit")
        if (namespaces.has(tag.uri)) handlers.open?.(tag, stack.map(item => item.local))
    })
    const onText = (text: string) => {
        if (stack.length && namespaces.has(stack[stack.length - 1].uri)) handlers.text?.(text, stack.map(item => item.local))
    }
    parser.on("text", onText)
    parser.on("cdata", onText)
    parser.on("closetag", tag => {
        if (namespaces.has(tag.uri)) handlers.close?.(tag, stack.map(item => item.local))
        stack.pop()
    })
    // close() is required: truncated XML must never become a partially imported workbook.
    parser.write(xmlText(data!)).close()
    requireData(rootSeen && !stack.length, `incomplete ${root} XML`)
}

type Relationship = { target: string; type: string; external: boolean }
function relationships(files: Map<string, Buffer>, source: string): Map<string, Relationship> {
    const path = source ? posix.join(posix.dirname(source), "_rels", `${posix.basename(source)}.rels`) : "_rels/.rels"
    const result = new Map<string, Relationship>()
    parseXml(files.get(path), "Relationships", PACKAGE_RELS, { open: (tag, path) => {
        if (path.join("/") !== "Relationships/Relationship") return
        const id = attribute(tag, "Id")
        const target = attribute(tag, "Target")
        const type = attribute(tag, "Type")
        requireData(Boolean(id && target && type) && !result.has(id!), "incomplete or duplicate relationship")
        result.set(id!, { target: target!, type: type!, external: attribute(tag, "TargetMode") === "External" })
    } })
    return result
}
function relationshipIs(relationship: Relationship, kind: string): boolean {
    return [...DOCUMENT_RELS].some(namespace => relationship.type === `${namespace}/${kind}`)
}
function targetPath(source: string, relationship: Relationship): string {
    requireData(!relationship.external, "external data relationship")
    const target = decodeURIComponent(relationship.target)
    requireData(!target.includes("\\") && !target.includes("\0") && !target.includes(":") && !/[?#]/.test(target), "unsafe relationship target")
    const resolved = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join(posix.dirname(source), target))
    requireData(!resolved.startsWith("../") && resolved !== ".." && !resolved.startsWith("/"), "relationship escapes archive")
    return resolved
}
function decodedString(value: string): string {
    requireData(value.length <= limits.textLength, "cell text limit")
    return value.replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}
function sharedStrings(data?: Buffer): string[] {
    if (!data) return []
    const result: string[] = []
    let value = ""
    parseXml(data, "sst", MAIN, {
        open: (tag, path) => { if (tag.local === "si" && path.length === 2) value = "" },
        text: (text, path) => {
            if (path[1] === "si" && path[path.length - 1] === "t" && !path.includes("rPh")) {
                value += text
                requireData(value.length <= limits.textLength, "shared string text limit")
            }
        },
        close: (tag, path) => {
            if (tag.local === "si" && path.length === 2) {
                requireData(result.length < limits.cells, "shared string count limit")
                result.push(decodedString(value))
            }
        },
    })
    return result
}
function positiveIndex(value: string | undefined, defaultValue: number, max: number): number {
    const result = value === undefined ? defaultValue : Number(value)
    requireData((value === undefined || /^\d+$/.test(value)) && Number.isInteger(result) && result > 0 && result <= max, "row or column limit")
    return result
}

function worksheet(data: Buffer | undefined, name: string, strings: string[], budget: { cells: number }): ParsedSheetData {
    const sheet: ParsedSheetData = { name, rowCount: 0, cells: [] }
    let row = 0
    let column = 0
    let cell: { column: number; type: string; raw: string; text: string; formula: string; hasFormula: boolean } | undefined
    const seenRows = new Set<number>()
    const seenColumns = new Set<number>()
    parseXml(data, "worksheet", MAIN, {
        open: (tag, path) => {
            const location = path.join("/")
            if (location === "worksheet/sheetData/row") {
                row = positiveIndex(attribute(tag, "r"), row + 1, limits.rows)
                requireData(!seenRows.has(row), "duplicate row")
                seenRows.add(row); seenColumns.clear(); column = 0
                sheet.rowCount = Math.max(sheet.rowCount, row)
            } else if (location === "worksheet/sheetData/row/c") {
                const address = attribute(tag, "r")
                if (address) {
                    const match = /^([A-Z]{1,3})([1-9]\d*)$/i.exec(address)
                    requireData(Boolean(match) && Number(match![2]) === row, "invalid cell address")
                    column = [...match![1].toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0)
                } else column++
                requireData(column <= limits.columns && !seenColumns.has(column) && ++budget.cells <= limits.cells, "cell count, column limit or duplicate cell")
                seenColumns.add(column)
                cell = { column, type: attribute(tag, "t") ?? "n", raw: "", text: "", formula: "", hasFormula: false }
            } else if (location === "worksheet/sheetData/row/c/f" && cell) cell.hasFormula = true
        },
        text: (text, path) => {
            if (!cell) return
            const location = path.join("/")
            if (location === "worksheet/sheetData/row/c/v") cell.raw += text
            else if (location === "worksheet/sheetData/row/c/f") cell.formula += text
            else if (path.slice(0, 5).join("/") === "worksheet/sheetData/row/c/is" && path[path.length - 1] === "t" && !path.includes("rPh")) cell.text += text
            requireData(Math.max(cell.raw.length, cell.text.length, cell.formula.length) <= limits.textLength, "cell text limit")
        },
        close: (tag, path) => {
            if (path.join("/") !== "worksheet/sheetData/row/c" || !cell) return
            let value: ParsedDataValue = null
            if (cell.type === "inlineStr") value = decodedString(cell.text)
            else if (cell.type === "str") value = decodedString(cell.raw)
            else if (cell.raw !== "") {
                switch (cell.type) {
                    case "s": {
                        requireData(/^\d+$/.test(cell.raw) && Number(cell.raw) < strings.length, "invalid shared string index")
                        value = strings[Number(cell.raw)]; break
                    }
                    case "b": requireData(cell.raw === "0" || cell.raw === "1", "invalid boolean"); value = cell.raw === "1"; break
                    case "n": requireData(cell.raw.trim() !== "" && Number.isFinite(Number(cell.raw)), "invalid number"); value = Number(cell.raw); break
                    case "d": value = new Date(cell.raw); requireData(Number.isFinite(value.getTime()), "invalid ISO date"); break
                    case "e": value = { error: cell.raw }; break
                    default: throw new Error("Unsupported XLSX cell type")
                }
            } else requireData(["n", "s", "b", "d", "e"].includes(cell.type), "unsupported empty cell type")
            // Preserve every <f>, including shared/array formula followers without text.
            // No formula execution and no replacement of formulas with cached literals.
            if (cell.hasFormula) value = { formula: cell.formula || "[shared formula]", ...(value !== null && typeof value !== "object" ? { result: value } : {}) }
            sheet.cells.push({ row, column: cell.column, value })
            cell = undefined
        },
    })
    return sheet
}

/** Namespace-aware, data-only OOXML fallback. Does not read styles, drawings,
 * macros, hyperlinks or external data. Relationships identify the actual parts.
 */
export function parseXlsxData(files: Map<string, Buffer>): ParsedWorkbookData {
    const rootRelations = relationships(files, "")
    const documents = [...rootRelations.values()].filter(relation => relationshipIs(relation, "officeDocument"))
    requireData(documents.length === 1, "missing or ambiguous workbook relationship")
    const workbookPath = targetPath("", documents[0])
    const defaults = new Map<string, string>()
    const overrides = new Map<string, string>()
    parseXml(files.get("[Content_Types].xml"), "Types", CONTENT_TYPES, { open: (tag, path) => {
        const location = path.join("/")
        if (location === "Types/Override" || location === "Types/Default") {
            const map = location === "Types/Override" ? overrides : defaults
            const key = attribute(tag, location === "Types/Override" ? "PartName" : "Extension")
            const contentType = attribute(tag, "ContentType")
            requireData(Boolean(key && contentType) && !map.has(key!), "invalid or duplicate content type")
            map.set(key!, contentType!)
        }
    } })
    const workbookContentType = overrides.get(`/${workbookPath}`) ?? defaults.get(posix.extname(workbookPath).slice(1))
    requireData(workbookContentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml", "workbook is not an XLSX spreadsheet")
    const relations = relationships(files, workbookPath)
    const shared = [...relations.values()].filter(relation => relationshipIs(relation, "sharedStrings"))
    requireData(shared.length <= 1, "ambiguous shared strings")
    const strings = sharedStrings(shared.length ? files.get(targetPath(workbookPath, shared[0])) : undefined)
    if (shared.length) requireData(files.has(targetPath(workbookPath, shared[0])), "missing shared strings")
    const sheets: { name: string; path: string }[] = []
    const names = new Set<string>()
    const paths = new Set<string>()
    parseXml(files.get(workbookPath), "workbook", MAIN, { open: (tag, path) => {
        if (path.join("/") !== "workbook/sheets/sheet") return
        const name = attribute(tag, "name")
        const id = attribute(tag, "id", DOCUMENT_RELS)
        const relation = id ? relations.get(id) : undefined
        requireData(Boolean(name && relation) && !names.has(name!.toLowerCase()), "missing or duplicate worksheet")
        names.add(name!.toLowerCase())
        if (!relationshipIs(relation!, "worksheet")) {
            requireData(relationshipIs(relation!, "chartsheet"), "unsupported sheet relationship")
            return
        }
        const sheetPath = targetPath(workbookPath, relation!)
        requireData(!paths.has(sheetPath) && sheets.length < limits.sheets, "worksheet alias or count limit")
        paths.add(sheetPath)
        sheets.push({ name: name!, path: sheetPath })
    } })
    requireData(sheets.length > 0, "no worksheets")
    const budget = { cells: 0 }
    return { sheets: sheets.map(sheet => worksheet(files.get(sheet.path), sheet.name, strings, budget)) }
}
