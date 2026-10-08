import { inflateRaw } from "node:zlib"
import { promisify } from "node:util"

export const XLSX_READ_LIMITS = {
    entries: 2048, entryBytes: 16 * 1024 * 1024, totalBytes: 48 * 1024 * 1024,
    sheets: 100, rows: 100000, columns: 16384, cells: 1000000, textLength: 1024 * 1024,
} as const

const inflate = promisify(inflateRaw)
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
    return value >>> 0
})
function crc32(buffer: Buffer): number {
    let crc = 0xffffffff
    for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
    return (crc ^ 0xffffffff) >>> 0
}

function requireZip(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(`Invalid or unsupported XLSX ZIP: ${message}`)
}

/** Classic ZIP only, entirely in memory. Validate directory BEFORE inflating, then
 * bound the actual zlib output as well (directory sizes may be dishonest).
 * ZIP64, split/encrypted archives and path aliases are deliberately unsupported.
 */
export async function readXlsxArchive(buffer: Buffer): Promise<Map<string, Buffer>> {
    let end = buffer.length - 22
    for (; end >= Math.max(0, buffer.length - 65557); end--) {
        if (buffer.readUInt32LE(end) === 0x06054b50 && end + 22 + buffer.readUInt16LE(end + 20) === buffer.length) break
    }
    requireZip(end >= Math.max(0, buffer.length - 65557), "missing end of directory")
    const count = buffer.readUInt16LE(end + 10)
    const directorySize = buffer.readUInt32LE(end + 12)
    const directoryStart = buffer.readUInt32LE(end + 16)
    requireZip(buffer.readUInt16LE(end + 4) === 0 && buffer.readUInt16LE(end + 6) === 0 && buffer.readUInt16LE(end + 8) === count, "split archive")
    requireZip(count > 0 && count <= XLSX_READ_LIMITS.entries && directoryStart + directorySize === end, "directory bounds or ZIP64")
    const entries: { name: string; start: number; compressed: number; expanded: number; crc: number; method: number }[] = []
    const names = new Set<string>()
    let cursor = directoryStart
    let total = 0
    for (let index = 0; index < count; index++) {
        requireZip(cursor + 46 <= end && buffer.readUInt32LE(cursor) === 0x02014b50, "directory entry")
        const flags = buffer.readUInt16LE(cursor + 8)
        const method = buffer.readUInt16LE(cursor + 10)
        const compressed = buffer.readUInt32LE(cursor + 20)
        const expanded = buffer.readUInt32LE(cursor + 24)
        const nameLength = buffer.readUInt16LE(cursor + 28)
        const extraLength = buffer.readUInt16LE(cursor + 30)
        const commentLength = buffer.readUInt16LE(cursor + 32)
        const local = buffer.readUInt32LE(cursor + 42)
        const next = cursor + 46 + nameLength + extraLength + commentLength
        requireZip(next <= end && buffer.readUInt16LE(cursor + 34) === 0 && !(flags & 1) && (method === 0 || method === 8), "encrypted entry or compression method")
        const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameLength)
        const name = new TextDecoder("utf-8", { fatal: true }).decode(rawName)
        requireZip(name.length > 0 && !name.startsWith("/") && !name.includes("\\") && !name.includes("\0") && !name.includes(":") && !name.split("/").some(part => part === ".." || part === "."), "unsafe entry name")
        requireZip(!names.has(name), "duplicate entry")
        names.add(name)
        total += expanded
        requireZip(expanded <= XLSX_READ_LIMITS.entryBytes && total <= XLSX_READ_LIMITS.totalBytes, "expanded size limit")
        requireZip(local + 30 <= directoryStart && buffer.readUInt32LE(local) === 0x04034b50, "local header")
        requireZip(!(buffer.readUInt16LE(local + 6) & 1) && buffer.readUInt16LE(local + 8) === method, "local compression mismatch")
        const localNameLength = buffer.readUInt16LE(local + 26)
        const start = local + 30 + localNameLength + buffer.readUInt16LE(local + 28)
        requireZip(start + compressed <= directoryStart && rawName.equals(buffer.subarray(local + 30, local + 30 + localNameLength)), "entry bounds or name mismatch")
        entries.push({ name, start, compressed, expanded, crc: buffer.readUInt32LE(cursor + 16), method })
        cursor = next
    }
    requireZip(cursor === end, "directory length mismatch")
    const files = new Map<string, Buffer>()
    for (const entry of entries) {
        const data = buffer.subarray(entry.start, entry.start + entry.compressed)
        const output = entry.method === 0 ? data : await inflate(data, { maxOutputLength: Math.max(1, entry.expanded) })
        requireZip(output.length === entry.expanded && crc32(output) === entry.crc, "entry length or CRC mismatch")
        files.set(entry.name, output)
    }
    return files
}
