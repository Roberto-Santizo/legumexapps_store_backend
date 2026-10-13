import { parseDatabaseConnection } from "./databaseConnection"
import { parseServerPort } from "./serverPort"

const local = "postgres://fixture:synthetic@127.0.0.1:5432/fixture"
test("local development is explicit; production always verifies TLS", () => {
    expect(parseDatabaseConnection(local, "test").ssl).toBe(false)
    expect(() => parseDatabaseConnection(local, "production")).toThrow()
    const secure = parseDatabaseConnection(local + "?sslmode=verify-full", "production")
    expect(secure.ssl).toEqual({ rejectUnauthorized: true })
    expect(secure).not.toHaveProperty("connectionString")
})
test.each(["?sslmode=require", "?sslmode=no-verify", "?sslmode=disable", "?options=role", "?sslmode=verify-full&sslmode=disable"])("remote rejects unsafe URL parameters %s", query => {
    expect(() => parseDatabaseConnection(local.replace("127.0.0.1", "fixture.invalid") + query, "production")).toThrow(/^Invalid PostgreSQL configuration/)
})
test("optional CA is explicit and cannot turn off verification", () => {
    const ca = "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----"
    expect(parseDatabaseConnection(local + "?sslmode=verify-full", "production", ca).ssl).toEqual({ rejectUnauthorized: true, ca })
    expect(() => parseDatabaseConnection(local, "test", ca)).toThrow()
})
test.each(["postgres://secret", local.replace(":5432", ""), local.replace("/fixture", "/bad%2Fname"), local + "#secret"])("errors omit URL and credentials", url => {
    try { parseDatabaseConnection(url, "production"); throw new Error("Expected rejection") } catch (error) {
        expect((error as Error).message).toBe("Invalid PostgreSQL configuration; explicit destination and verified TLS required")
    }
})
test("Render PORT takes precedence; legacy local port remains supported", () => {
    expect(parseServerPort("10000", "3000")).toBe(10000)
    expect(parseServerPort(undefined, "4000")).toBe(4000)
    expect(parseServerPort(undefined, undefined)).toBe(3000)
    for (const value of ["0", "-1", "65536", "3000x", "", " 3000"]) expect(() => parseServerPort(value, undefined)).toThrow()
})
