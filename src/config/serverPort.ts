export function parseServerPort(port: string | undefined, legacyPort: string | undefined): number {
    const value = port ?? legacyPort ?? "3000"
    if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) throw new Error("Invalid HTTP port; expected an integer from 1 to 65535")
    return Number(value)
}
