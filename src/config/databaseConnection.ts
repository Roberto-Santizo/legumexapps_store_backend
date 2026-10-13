import { isIP } from "node:net"

/** Explicit PostgreSQL parameters. Never pass an opaque URL to the driver. */
export function parseDatabaseConnection(value: string, mode: string, ca?: string) {
    const invalid = (): never => { throw new Error("Invalid PostgreSQL configuration; explicit destination and verified TLS required") }
    let url: URL
    try { url = new URL(value) } catch { return invalid() }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.port || !url.username || !url.password || url.hash) return invalid()
    let database: string, username: string, password: string
    try { database = decodeURIComponent(url.pathname.slice(1)); username = decodeURIComponent(url.username); password = decodeURIComponent(url.password) } catch { return invalid() }
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    if (!database || [...database + username].some(char => char.charCodeAt(0) <= 32 || char === "/" || char === "\\") || !username || !password) return invalid()
    if (!isIP(host) && !host.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) return invalid()
    const port = Number(url.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return invalid()
    const parameters = [...url.searchParams.keys()]
    if (parameters.length > 1 || parameters.some(key => key !== "sslmode")) return invalid()
    const sslmode = url.searchParams.get("sslmode")
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(host)
    if (sslmode !== null && !["verify-full", "disable"].includes(sslmode)) return invalid()
    if ((mode === "production" || !loopback) && sslmode !== "verify-full") return invalid()
    if (ca !== undefined && (!ca.includes("-----BEGIN CERTIFICATE-----") || sslmode !== "verify-full")) return invalid()
    return { database, username, password, host, port,
        ssl: sslmode === "verify-full" ? { rejectUnauthorized: true as const, ...(ca ? { ca } : {}) } : false as const }
}
