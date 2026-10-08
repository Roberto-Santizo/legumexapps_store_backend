import JSZip from "jszip"

/** Valid OOXML namespace rewrite used by multiple producers (for example XML serializers that
 * choose explicit prefixes). Synthetic regression fixture.
 */
export async function prefixSpreadsheetNamespaces(buffer: Buffer, parts: "all" | "workbook" = "all"): Promise<Buffer> {
    const zip = await JSZip.loadAsync(buffer)
    for (const name of Object.keys(zip.files)) {
        if (!/^xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue
        if (parts === "workbook" && name !== "xl/workbook.xml") continue
        const xml = await zip.file(name)!.async("string")
        const prefixed = xml.replace(/(<\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, "$1m:$2")
            .replace(/(<m:[\w.-]+)(?=[\s>])/, '$1 xmlns:m="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
        zip.file(name, prefixed)
    }
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}
