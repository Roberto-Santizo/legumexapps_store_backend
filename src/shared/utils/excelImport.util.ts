import ExcelJS from "exceljs"

// Plumbing compartido por TODAS las cargas masivas de Excel del admin (Empaques, Ingredientes,
// y cualquier catálogo futuro que lo necesite) -- mismo diseño en los 3: encabezados tolerantes
// a variaciones de tipeo, inserción atómica, filas vacías ignoradas. Lo que SÍ cambia por catálogo
// (columnas, validaciones, mapeos de texto libre a keys internas) vive en la carpeta de cada
// feature (ver packagingImport.constant.ts / ingredientImport.constant.ts).

// Rango Unicode de "combining diacritical marks" (U+0300-U+036F) construido con
// String.fromCharCode en vez de un literal embebido en el regex -- evita cualquier ambigüedad
// de encoding entre el código fuente y los acentos que en realidad tiene que reconocer.
const COMBINING_DIACRITICS_REGEX = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g")

// Lo que puede quedar de una celda de Excel ya leída (ver readImportCell) -- null significa
// "columna no mapeada o celda vacía", nunca "el archivo trae la palabra null". Único alias
// para este tipo: lo usan tanto este módulo como los helpers de resolución de campo de cada
// service de import (Empaques, Ingredientes) que reciben el valor crudo de una celda.
export type ImportCellValue = string | number | null

// trim + minúsculas + sin acentos -- tolera variaciones razonables de tipeo tanto en
// encabezados como en texto libre de celdas ("Material de Paletización" vs
// "material de paletizacion" vs "PALLET"). Recibe ImportCellValue (nunca el objeto enriquecido
// que ExcelJS puede dejar en una celda -- ver extractCellValue) para no terminar normalizando
// silenciosamente a "[object object]".
export function normalizeImportText(value: ImportCellValue): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(COMBINING_DIACRITICS_REGEX, "")
}

// ExcelJS puede devolver el valor de una celda como string/number/boolean directo, o como un
// objeto enriquecido (fórmulas, hipervínculos, texto con formato) -- ningún archivo de import
// espera fórmulas, pero se cubre el caso para no reventar con `[object Object]` si alguien pega
// una celda con formato raro. Compartido por readImportCell (celdas de datos) y mapImportHeaders
// (celdas de encabezado) -- mismo tipo de valor crudo, mismo desempaquetado.
function extractCellValue(value: ExcelJS.CellValue): ImportCellValue {
    if (value === null || value === undefined) return null
    if (typeof value === "object") {
        const rich = value as { text?: string; result?: unknown; richText?: { text: string }[] }
        if (rich.richText) return rich.richText.map(part => part.text).join("")
        if (typeof rich.result === "string" || typeof rich.result === "number") return rich.result
        if (typeof rich.text === "string") return rich.text
        return null
    }
    // Una celda booleana (ej. casilla de verificación pegada por error) no tiene sentido para
    // ningún campo de texto/número de estos imports -- se pasa como texto para que el validador
    // de cada feature la rechace con un mensaje claro en vez de que este helper reviente de tipos.
    return typeof value === "boolean" ? String(value) : value
}

export function readImportCell(row: ExcelJS.Row, columnIndex: number | undefined): ImportCellValue {
    if (columnIndex === undefined) return null
    return extractCellValue(row.getCell(columnIndex).value)
}

// Fila "en blanco" = todas las columnas que SÍ se lograron mapear del encabezado están vacías en
// esa fila -- huecos típicos que deja Excel entre bloques de datos, no se cuentan como error.
export function isImportRowBlank<TField extends string>(row: ExcelJS.Row, columnIndexByField: Map<TField, number>): boolean {
    return Array.from(columnIndexByField.values()).every(columnIndex => {
        const value = readImportCell(row, columnIndex)
        return value === null || value === ""
    })
}

export interface ImportColumnDef {
    header: string
    // Encabezados alternativos aceptados (ya normalizados con normalizeImportText) -- tolera
    // variaciones razonables sin obligar a que el archivo calce carácter por carácter con la
    // plantilla descargable.
    aliases: string[]
}

// Mapea la fila de encabezados (fila 1) a la columna física en la que está cada campo conocido,
// por alias normalizado -- así el archivo no tiene que respetar un orden fijo de columnas.
export function mapImportHeaders<TField extends string>(
    headerRow: ExcelJS.Row,
    columns: Record<TField, ImportColumnDef>
): Map<TField, number> {
    const columnIndexByField = new Map<TField, number>()
    const entries = Object.entries(columns) as [TField, ImportColumnDef][]
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const normalized = normalizeImportText(extractCellValue(cell.value))
        const field = entries.find(([, def]) => def.aliases.includes(normalized))?.[0]
        if (field) columnIndexByField.set(field, colNumber)
    })
    return columnIndexByField
}

// "Sí"/"No" (y variantes: true/false, 1/0, x) -- undefined = texto no reconocido, el caller debe
// reportarlo como error de fila en vez de asumir un valor. Celda vacía = defaultValue (para que
// el default del modelo de negocio, no un default de parseo, sea el que decide).
const TRUE_TOKENS = new Set(["si", "true", "1", "x", "yes"])
const FALSE_TOKENS = new Set(["no", "false", "0"])
export function parseImportBoolean(value: ImportCellValue, defaultValue: boolean): boolean | undefined {
    if (value === null || value === "") return defaultValue
    const normalized = normalizeImportText(value)
    if (TRUE_TOKENS.has(normalized)) return true
    if (FALSE_TOKENS.has(normalized)) return false
    return undefined
}

// Cast puntual: los tipos de exceljs declaran su propio `Buffer extends ArrayBuffer` global
// (bug conocido de sus .d.ts), que con `"lib": ["esnext"]` de este tsconfig termina exigiendo
// miembros nuevos de ArrayBuffer (maxByteLength/resizable/etc.) que el Buffer real de Node no
// implementa -- un choque puramente de tipos, no de runtime. Se aísla acá (único lugar del
// programa que toca la API de exceljs) para que cada service de import no repita el cast.
export async function loadWorkbookFromBuffer(buffer: Buffer): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver comentario de arriba
    await workbook.xlsx.load(buffer as any)
    return workbook
}

export async function writeWorkbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>
}
