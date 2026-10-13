import { parseFrontendOrigin } from "./frontendOrigin"
import { frontendCors } from "./frontendCors"
import type { Request, Response } from "express"

test.each(["https://frontend.example.", "https://frontend.example.:443", "https://frontend.example:0", "http://localhost:0", "https://frontend.example:000"])("rejects trailing-dot hosts and zero ports %s in every mode", value => {
    for (const mode of ["development", "test", "production"]) expect(() => parseFrontendOrigin(value, mode)).toThrow(/^Invalid FRONTEND_URL:/)
})

test.each(["development", "test"])("local default in %s", mode => {
    expect(parseFrontendOrigin(undefined, mode)).toBe("http://localhost:5173")
    expect(parseFrontendOrigin("http://127.0.0.1:5174", mode)).toBe("http://127.0.0.1:5174")
})

test.each(["https://frontend.example", "https://evil.example", "https://frontend.example:8443", "null", undefined])("OPTIONS preflight authorizes only exact origin %j", origin => {
    const headers: Record<string, string> = { vary: "Accept-Encoding" }
    const req = { method: "OPTIONS", headers: { origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "Authorization, Content-Type, Accept-Language",
    } } as Request
    const end = jest.fn()
    const res = { setHeader: (key: string, value: string) => { headers[key.toLowerCase()] = value },
        getHeader: (key: string) => headers[key.toLowerCase()], end, statusCode: 200 } as unknown as Response
    const next = jest.fn()
    frontendCors("https://frontend.example")(req, res, next)
    if (origin === "https://frontend.example") {
        expect(headers["access-control-allow-origin"]).toBe(origin)
        expect(headers["access-control-allow-headers"]).toBe("Authorization, Content-Type, Accept-Language")
        expect(headers["access-control-allow-methods"].split(",")).toContain("POST")
        expect(headers.vary.split(/,\s*/)).toEqual(expect.arrayContaining(["Accept-Encoding", "Origin", "Access-Control-Request-Headers"]))
        expect(res.statusCode).toBe(204)
        expect(end).toHaveBeenCalledTimes(1)
        expect(next).not.toHaveBeenCalled()
    } else {
        expect(Object.keys(headers).some(key => key.startsWith("access-control-"))).toBe(false)
        expect(next).toHaveBeenCalledTimes(1)
        expect(end).not.toHaveBeenCalled()
    }
    expect(headers["access-control-allow-credentials"]).toBeUndefined()
})
test("canonical HTTPS origin with optional port", () => {
    expect(parseFrontendOrigin("https://Frontend.example:443", "production")).toBe("https://frontend.example")
    expect(parseFrontendOrigin("https://frontend.example:8443", "production")).toBe("https://frontend.example:8443")
})
test.each([undefined, "", "http://frontend.example", "https://localhost", "https://LOCALHOST.", "https://sub.localhost", "https://127.0.0.1", "https://127.1", "https://2130706433", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://0.0.0.0"])("production rejects missing/insecure/local value %j", value => {
    expect(() => parseFrontendOrigin(value, "production")).toThrow(/^Invalid FRONTEND_URL:/)
})
test.each(["*", "null", "https://frontend.example/", "https://frontend.example/path", "https://frontend.example?x=1", "https://frontend.example#hash", "https://user:secret@frontend.example", " https://frontend.example", "https://frontend.example ", "ftp://frontend.example", "https://frontend.example:99999", "https://a.example,https://b.example", "https://*.example", "https://bad_host.example", "https://frontend.example\\path"])("invalid origin %j rejected in every environment safely", value => {
    for (const mode of ["development", "test", "production"]) {
        expect(() => parseFrontendOrigin(value, mode)).toThrow(/^Invalid FRONTEND_URL:/)
        try { parseFrontendOrigin(value, mode) } catch (error) { expect((error as Error).message).not.toContain(value) }
    }
})
test.each(["https://frontend.example", "https://evil.example", "https://frontend.example.evil.example", "http://frontend.example", "https://frontend.example:8443", "null", undefined])("CORS authorizes only exact origin %j without HTTP listener", origin => {
    const headers: Record<string, string> = {}
    const req = { method: "GET", headers: { origin } } as Request
    const res = { setHeader: (key: string, value: string) => { headers[key.toLowerCase()] = value }, getHeader: (key: string) => headers[key.toLowerCase()] } as unknown as Response
    const next = jest.fn()
    frontendCors("https://frontend.example")(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(headers["access-control-allow-origin"]).toBe(origin === "https://frontend.example" ? origin : undefined)
    expect(headers["access-control-allow-credentials"]).toBeUndefined()
})
