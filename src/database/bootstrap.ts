import bcrypt from "bcryptjs"
import { PERMISSIONS, ADMIN_ROLE_NAME } from "../features/accessControl/permissions/constants/accessControlPolicy"
import { UNIT_CATALOG } from "../features/unit/constants/unitCatalog"
import { assertDatabaseReady, assertPostgresCapabilities, assertNoUnexpectedBehavior } from "./schemaReadiness"
import type { Sequelize } from "sequelize-typescript"
import { QueryTypes } from "sequelize"
import { createDatabaseSchema, assertEmptyDatabase } from "./schemaCreation"

interface BootstrapClient { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }> }
export interface BootstrapCredentials { username: string; password: string }
export function validateBootstrapCredentials(input: BootstrapCredentials): void {
    if (!input || !/^[a-zA-Z0-9_.@-]{3,100}$/.test(input.username) || typeof input.password !== "string"
        || [...input.password].length < 16 || Buffer.byteLength(input.password, "utf8") > 72 || /[\x00-\x1f\x7f]/.test(input.password)) {
        throw new Error("Invalid bootstrap credentials; explicit username and password of at least 16 characters, at most 72 UTF-8 bytes and no control characters required")
    }
}

export interface InitializationIdentity {
    database: string; role: string; database_oid: string; server_address: string; server_port: number
}

/** Inspection only, valid both before confirmation and again inside the creation transaction. */
export async function inspectEmptyDatabase(client: BootstrapClient): Promise<InitializationIdentity> {
    await assertPostgresCapabilities(client)
    await assertEmptyDatabase(client)
    await assertNoUnexpectedBehavior(client)
    const { rows } = await client.query(`SELECT current_database() AS database,current_user AS role,d.oid::text AS database_oid,
        inet_server_addr()::text AS server_address,inet_server_port() AS server_port,
        has_database_privilege(current_user,current_database(),'CONNECT') AS connect,
        has_schema_privilege(current_user,'public','USAGE') AS usage,
        has_schema_privilege(current_user,'public','CREATE') AS create,
        has_language_privilege(current_user,'plpgsql','USAGE') AS language
        FROM pg_catalog.pg_database d WHERE d.datname=current_database()`)
    if (rows.length!==1 || ['connect','usage','create','language'].some(key=>rows[0][key]!==true))
        throw new Error("Initialization requires CONNECT, public USAGE/CREATE and plpgsql USAGE privileges")
    const {database,role,database_oid,server_address,server_port}=rows[0]
    return {database,role,database_oid,server_address,server_port}
}

/** Explicit creation of a new empty database only. DDL and initial references commit together. */
export async function bootstrapDatabase(db: Sequelize, credentials: BootstrapCredentials, expected?: InitializationIdentity): Promise<void> {
    validateBootstrapCredentials(credentials)
    await db.transaction(async transaction => {
        await db.query("SET LOCAL statement_timeout='120000ms'",{transaction})
        await db.query("SET LOCAL lock_timeout='5000ms'",{transaction})
        const client: BootstrapClient={query:async(sql,values)=>({rows:await db.query(sql,{bind:values,type:QueryTypes.SELECT,transaction}) as any[]})}
        await assertPostgresCapabilities(client)
        if ((await client.query('SELECT pg_try_advisory_xact_lock(174227,1) AS acquired')).rows[0]?.acquired!==true)
            throw new Error("Another initialization is active; no changes were made")
        const identity=await inspectEmptyDatabase(client)
        if (expected && JSON.stringify(identity)!==JSON.stringify(expected)) throw new Error("Initialization destination changed after confirmation")
        await createDatabaseSchema(db,transaction)
        for (const item of PERMISSIONS) await client.query(`INSERT INTO public.permissions(name,"isActive","createdAt","updatedAt") VALUES ($1,true,NOW(),NOW())`,[item.name])
        const role=(await client.query(`INSERT INTO public.roles(name,"isActive","createdAt","updatedAt") VALUES ($1,true,NOW(),NOW()) RETURNING id`,[ADMIN_ROLE_NAME])).rows[0].id
        await client.query('INSERT INTO public.role_permissions(role_id,permission_id) SELECT $1,id FROM public.permissions',[role])
        for (const unit of UNIT_CATALOG) await client.query(`INSERT INTO public.units("unitCode","displayName","unitType","baseFactor","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,$4,true,NOW(),NOW())`,[unit.key,unit.displayName,unit.unitType,unit.baseFactor])
        const password=await bcrypt.hash(credentials.password,12)
        await client.query(`INSERT INTO public.users(name,username,password,role_id,"isActive",failed_attempts,"createdAt","updatedAt") VALUES ($1,$1,$2,$3,true,0,NOW(),NOW())`,[credentials.username,password,role])
        await assertDatabaseReady(client,db)
    })
}
