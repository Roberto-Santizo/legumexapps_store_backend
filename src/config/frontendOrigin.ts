import { isIP } from "node:net"

export function parseFrontendOrigin(value: string | undefined, mode: string): string {
    const candidate = value === undefined && (mode === "development" || mode === "test") ? "http://localhost:5173" : value
    const invalid = (): never => { throw new Error("Invalid FRONTEND_URL: configure one HTTP(S) origin without credentials, paths, query, fragment or whitespace; production requires HTTPS and a non-loopback host") }
    if (!candidate || !/^https?:\/\/[^/?#\s\\]+$/.test(candidate)) return invalid()
    let url: URL
    try { url = new URL(candidate) } catch { return invalid() }
    if (url.username || url.password || url.origin === "null" || url.port === "0" || url.hostname.endsWith(".")) return invalid()
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    const domain = host.replace(/\.$/, "")
    if (!isIP(host) && (!domain || domain.length > 253 || !domain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) return invalid()
    const loopback = domain === "localhost" || domain.endsWith(".localhost") || host === "::1" || host === "::" || host === "0.0.0.0"
        || /^127\./.test(host) || /^::ffff:(?:7f[0-9a-f]{2}:|127\.)/.test(host)
    if (mode === "production" && (url.protocol !== "https:" || loopback)) return invalid()
    return url.origin
}
