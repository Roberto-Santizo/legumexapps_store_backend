export type DatabaseRolePolicy = "restricted" | "owner"

/** Explicit acceptance of schema-owner credentials; never inferred from NODE_ENV. */
export function parseDatabaseRolePolicy(value: string | undefined): DatabaseRolePolicy {
    if (value === undefined || value === "restricted") return "restricted"
    if (value === "owner") return "owner"
    throw new Error("Invalid DB_ROLE_POLICY: expected restricted or owner")
}
