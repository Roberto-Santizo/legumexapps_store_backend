import { createHash } from "node:crypto"

// Huella SHA-256 estable de un valor serializable (JSON.stringify).
export function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
