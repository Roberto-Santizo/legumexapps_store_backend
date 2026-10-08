import JSZip from "jszip"
import { readXlsxArchive } from "./xlsxArchive.util"

async function archive(name = "xl/workbook.xml", content = "<workbook/>"): Promise<Buffer> {
    const zip = new JSZip()
    zip.file(name, content)
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}
describe("bounded XLSX ZIP reader", () => {
    it("reads stored and deflated files in memory, including ZIP comments", async () => {
        const zip = new JSZip()
        zip.file("stored.xml", "stored", { compression: "STORE" })
        zip.file("deflated.xml", "deflated", { compression: "DEFLATE" })
        const data = await zip.generateAsync({ type: "nodebuffer", comment: "PK\x05\x06 comment" })
        const files = await readXlsxArchive(data)
        expect(files.get("stored.xml")?.toString()).toBe("stored")
        expect(files.get("deflated.xml")?.toString()).toBe("deflated")
    })
    it.each(["../escape.xml", "/absolute.xml", "xl/../escape.xml", "xl\\escape.xml", "C:/escape.xml"])("rejects unsafe path %s without filesystem extraction", async name => {
        await expect(readXlsxArchive(await archive(name))).rejects.toThrow(/unsafe entry name/)
    })
    it("rejects a tampered central-directory CRC", async () => {
        const data = await archive()
        const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
        data.writeUInt32LE((data.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16)
        await expect(readXlsxArchive(data)).rejects.toThrow(/CRC mismatch/)
    })
    it("rejects an encrypted-entry flag before decompression", async () => {
        const data = await archive()
        const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
        data.writeUInt16LE(data.readUInt16LE(central + 8) | 1, central + 8)
        await expect(readXlsxArchive(data)).rejects.toThrow(/encrypted entry/)
    })
    it("rejects a false directory entry count", async () => {
        const data = await archive()
        data.writeUInt16LE(2049, data.length - 22 + 10)
        data.writeUInt16LE(2049, data.length - 22 + 8)
        await expect(readXlsxArchive(data)).rejects.toThrow(/directory bounds/)
    })
    it("rejects a local-header filename differing from the directory", async () => {
        const data = await archive()
        data[30] ^= 1
        await expect(readXlsxArchive(data)).rejects.toThrow(/name mismatch/)
    })
})
