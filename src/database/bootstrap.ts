import bcrypt from "bcryptjs"
import { PERMISSIONS, ADMIN_ROLE_NAME } from "./accessControlPolicy"
import { UNIT_CATALOG } from "../features/unit/constants/unitCatalog"
import { assertBootstrapReady } from "./schemaReadiness"

interface BootstrapClient { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }> }
export interface BootstrapCredentials { username: string; password: string }
export function validateBootstrapCredentials(input: BootstrapCredentials): void {
    if (!input || !/^[a-zA-Z0-9_.@-]{3,100}$/.test(input.username) || typeof input.password !== "string"
        || input.password.length < 16 || Buffer.byteLength(input.password, "utf8") > 72) {
        throw new Error("Invalid bootstrap credentials; explicit username and password of 16 to 72 UTF-8 bytes required")
    }
}

/** Administrative operation only. No production records or economic defaults. Never invoked by startup. */
export async function bootstrapDatabase(client: BootstrapClient, credentials: BootstrapCredentials): Promise<void> {
    validateBootstrapCredentials(credentials)
    await client.query("BEGIN")
    let stage = "permissions"
    try {
        await client.query("SET LOCAL lock_timeout = '5s'")
        await client.query("SET LOCAL statement_timeout = '30s'")
        await client.query("SELECT pg_advisory_xact_lock(174226, 1)")
        for (const permission of PERMISSIONS) {
            await client.query(`INSERT INTO public.permissions(name,"isActive","createdAt","updatedAt") VALUES ($1,true,NOW(),NOW()) ON CONFLICT(name) DO NOTHING`, [permission.name])
        }
        stage = "administrator"
        await client.query(`INSERT INTO public.roles(name,"isActive","createdAt","updatedAt") VALUES ($1,true,NOW(),NOW()) ON CONFLICT(name) DO NOTHING`, [ADMIN_ROLE_NAME])
        const { rows: roles } = await client.query('SELECT id,"isActive" FROM public.roles WHERE name=$1 FOR UPDATE', [ADMIN_ROLE_NAME])
        if (roles.length !== 1 || !roles[0].isActive) throw new Error("Bootstrap role is inconsistent")
        const role = roles[0].id
        await client.query(`INSERT INTO public.role_permissions(role_id,permission_id) SELECT $1,id FROM public.permissions WHERE name=ANY($2::text[]) AND "isActive"=true ON CONFLICT DO NOTHING`, [role, PERMISSIONS.map(item => item.name)])
        const { rows: users } = await client.query('SELECT id,password,role_id,"isActive" FROM public.users WHERE username=$1 FOR UPDATE', [credentials.username])
        if (users.length) {
            if (users.length !== 1 || !users[0].isActive || users[0].role_id !== role || !await bcrypt.compare(credentials.password, users[0].password)) {
                throw new Error("Existing bootstrap administrator differs; no account was overwritten")
            }
        } else {
            const hash = await bcrypt.hash(credentials.password, 12)
            await client.query(`INSERT INTO public.users(name,username,password,role_id,"isActive",failed_attempts,"createdAt","updatedAt") VALUES ($1,$1,$2,$3,true,0,NOW(),NOW())`, [credentials.username, hash, role])
        }
        stage = "units"
        for (const unit of UNIT_CATALOG) {
            const { rows } = await client.query('SELECT id,"isActive" FROM public.units WHERE "unitType"=$1 AND "baseFactor"=$2 FOR UPDATE', [unit.unitType, unit.baseFactor])
            if (rows.length > 1 || (rows.length && !rows[0].isActive)) throw new Error("Bootstrap units are inconsistent")
            if (!rows.length) await client.query(`INSERT INTO public.units("unitCode","displayName","unitType","baseFactor","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,$4,true,NOW(),NOW())`, [unit.key, unit.displayName, unit.unitType, unit.baseFactor])
        }
        stage = "verification"
        await assertBootstrapReady(client)
        await client.query("COMMIT")
    } catch (error) {
        try { await client.query("ROLLBACK") } catch { throw new Error("Bootstrap failed and rollback could not be verified; details suppressed") }
        const code = typeof (error as { code?: unknown })?.code === "string" && /^[A-Z0-9]{5}$/.test((error as { code: string }).code) ? (error as { code: string }).code : "validation"
        throw new Error(`Bootstrap rejected at ${stage} (${code}); changes rolled back, sensitive details suppressed`)
    }
}
