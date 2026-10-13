import { parseNodeEnv } from "./nodeEnv"
import { parseFrontendOrigin } from "./frontendOrigin"

test.each(["development", "test", "production"] as const)("preserves exact mode %s", mode => {
    expect(parseNodeEnv(mode)).toBe(mode)
})
test("absence preserves local development default, never implies production", () => {
    expect(parseNodeEnv(undefined)).toBe("development")
    expect(parseFrontendOrigin(undefined, parseNodeEnv(undefined))).toBe("http://localhost:5173")
    expect(() => parseFrontendOrigin(undefined, parseNodeEnv("production"))).toThrow(/^Invalid FRONTEND_URL:/)
})
test.each(["Production", "production ", " production", "production\n", "staging", "", " ", "TEST", "1"])("rejects invalid NODE_ENV %j without normalization", value => {
    expect(() => parseNodeEnv(value)).toThrow(/^Invalid NODE_ENV: expected exactly development, test, or production;/)
})
