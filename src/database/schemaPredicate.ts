/** Canonical boolean structure for current CHECK contracts; never evaluates SQL. */
export function predicateContract(source: string): string {
    // Normalize PostgreSQL's transparent renderings, never erase arbitrary column casts.
    // In particular, numeric::integer changes rounding and must fail the contract.
    const scalar = (text: string) => text
        .replace(/('(?:''|[^'])*')\s*::(?:"enum_[^"]+"|enum_[a-zA-Z_]\w*)/g, "$1")
        .replace(/\(\s*(-?\d+(?:\.\d+)?)\s*\)\s*::numeric\b/g, "$1")
        .replace(/\b(\d+(?:\.\d+)?)\s*::numeric\b/g, "$1")
        .replace(/::(?:text|character varying)(?:\[\])?/gi, "")
        .split(/('(?:''|[^'])*')/).map(part => part.startsWith("'") ? part : part.toLowerCase().replace(/[\s"()]/g, "")).join("")
    function boundaries(text: string, keyword?: string): number[] {
        let depth = 0, quote = ""
        const found = []
        for (let i = 0; i < text.length; i++) {
            const ch = text[i]
            if (quote) {
                if (ch === quote && text[i + 1] === quote) i++
                else if (ch === quote) quote = ""
                continue
            }
            if (ch === "'" || ch === '"') { quote = ch; continue }
            if (ch === "(") depth++
            if (ch === ")") { depth--; if (depth === 0 && !keyword) found.push(i) }
            if (keyword && depth === 0 && text.slice(i, i + keyword.length).toUpperCase() === keyword
                && !/[\w]/.test(text[i - 1] ?? "") && !/[\w]/.test(text[i + keyword.length] ?? "")) found.push(i)
        }
        return found
    }
    function parse(input: string): unknown {
        let text = input.trim()
        while (text.startsWith("(") && boundaries(text)[0] === text.length - 1) text = text.slice(1, -1).trim()
        for (const operator of ["OR", "AND"]) {
            const points = boundaries(text, operator)
            if (points.length) {
                let start = 0
                const children: unknown[] = []
                for (const end of [...points, text.length]) {
                    const child = parse(text.slice(start, end))
                    if (Array.isArray(child) && child[0] === operator) children.push(...child.slice(1))
                    else children.push(child)
                    start = end + operator.length
                }
                return [operator, ...children]
            }
        }
        return scalar(text)
    }
    return JSON.stringify(parse(source.replace(/^CHECK\s*/i, "")))
}
