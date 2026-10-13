export type NodeEnv = "development" | "test" | "production"

export function parseNodeEnv(value: string | undefined): NodeEnv {
    if (value === undefined) return "development"
    if (value === "development" || value === "test" || value === "production") return value
    throw new Error("Invalid NODE_ENV: expected exactly development, test, or production; omit only for local development")
}
