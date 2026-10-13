import { promises as fs } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import type { Sequelize } from "sequelize-typescript"
import { verifyMigrationHistory } from "./migrationHistory"
import { ADMIN_ROLE_NAME, PERMISSIONS } from "./accessControlPolicy"
import { UNIT_CATALOG } from "../features/unit/constants/unitCatalog"
import { predicateContract } from "./schemaPredicate"
import type { DatabaseRolePolicy } from "../config/databaseRolePolicy"

export interface InspectionClient { query(sql: string): Promise<{ rows: any[] }> }
const reject = (): never => { throw new Error("Database readiness rejected; migration, schema or bootstrap mismatch") }
const normalized = (value: string) => value.toLowerCase().replace(/::(?:text|character varying)/g, "").replace(/[\s"()]/g, "")

export async function assertApplicationRole(client: InspectionClient, policy: DatabaseRolePolicy = "restricted"): Promise<void> {
    const { rows } = await client.query(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
        has_schema_privilege(current_user,'public','CREATE') AS schema_create,
        has_table_privilege(current_user,'public.schema_migrations','INSERT,UPDATE,DELETE,TRUNCATE') AS ledger_write,
        current_setting('transaction_read_only') AS transaction_mode
        FROM pg_roles r WHERE r.rolname=current_user`)
    const flags = ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "schema_create", "ledger_write"]
    if (!["restricted", "owner"].includes(policy) || rows.length !== 1 || rows[0].transaction_mode !== "on"
        || flags.some(key => typeof rows[0][key] !== "boolean")) return reject()
    const forbidden = policy === "owner" ? ["rolsuper", "rolreplication", "rolbypassrls"] : flags
    if (forbidden.some(key => rows[0][key] !== false)) return reject()
}

export async function migrationManifest() {
    const directory = path.resolve(__dirname, "../../migrations")
    const entries = (await fs.readdir(directory, { withFileTypes: true })).filter(entry => /\.sql$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))
    const result = []
    for (const entry of entries) {
        if (!entry.isFile() || !/^\d{12}_[a-z_]+\.sql$/.test(entry.name)) return reject()
        const sql = (await fs.readFile(path.join(directory, entry.name), "utf8")).replace(/\r\n/g, "\n")
        result.push({ version: entry.name, checksum: createHash("sha256").update(sql).digest("hex") })
    }
    return result
}

/** SELECT-only validation; callers supply a read-only transaction on their own connection. */
export async function assertSchemaReady(client: InspectionClient, sequelize: Sequelize): Promise<void> {
    const history = await client.query("SELECT version, checksum FROM public.schema_migrations ORDER BY version")
    if (verifyMigrationHistory(await migrationManifest(), history.rows).status !== "up_to_date") return reject()
    const { rows: columns } = await client.query(`SELECT c.relname AS table_name, a.attname AS column_name,
        format_type(a.atttypid,a.atttypmod) AS sql_type, a.attnotnull AS not_null,
        pg_get_expr(d.adbin,d.adrelid) AS column_default,
        ARRAY(SELECT e.enumlabel::text FROM pg_enum e WHERE e.enumtypid=a.atttypid ORDER BY e.enumsortorder) AS enum_values
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`)
    const { rows: constraints } = await client.query(`SELECT c.relname AS table_name, con.conname AS name, con.contype AS kind,
        con.convalidated AS validated, pg_get_constraintdef(con.oid) AS definition,
        ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(id,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.id ORDER BY k.ord) AS keys,
        r.relname AS target_table, rn.nspname AS target_schema,
        ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(id,ord) JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=k.id ORDER BY k.ord) AS target_keys,
        con.confdeltype AS delete_action, con.confupdtype AS update_action
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_class r ON r.oid=con.confrelid LEFT JOIN pg_namespace rn ON rn.oid=r.relnamespace WHERE n.nspname='public'`)
    const { rows: indexes } = await client.query(`SELECT c.relname AS table_name, i.relname AS name, x.indisunique AS is_unique,
        (x.indisvalid AND x.indisready AND x.indislive AND x.indpred IS NULL) AS valid,
        ARRAY(SELECT pg_get_indexdef(x.indexrelid,k,false) FROM generate_series(1,x.indnkeyatts) k) AS keys
        FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`)
    const action = (value?: string) => ({ CASCADE: "c", RESTRICT: "r", "SET NULL": "n", "NO ACTION": "a", "SET DEFAULT": "d" }[value ?? "NO ACTION"])
    for (const model of sequelize.modelManager.models) {
        const table = String(model.getTableName())
        const attrs = Object.values(model.rawAttributes)
        for (const attr of attrs) {
            const field = attr.field!
            const column = columns.find(row => row.table_name === table && row.column_name === field)
            if (!column || column.not_null !== (attr.primaryKey === true || attr.allowNull === false)) return reject()
            const type = attr.type as any
            if (type.values) {
                if (column.sql_type.replace(/"/g, "") !== `enum_${table}_${field}` || JSON.stringify(column.enum_values) !== JSON.stringify(type.values)) return reject()
            } else {
                const expected = type.toSql().toLowerCase().replace(/^varchar/, "character varying").replace(/^decimal/, "numeric")
                if (normalized(column.sql_type) !== normalized(expected)) return reject()
            }
            if (attr.autoIncrement && !column.column_default?.startsWith("nextval(")) return reject()
            if (typeof attr.defaultValue === "boolean" && column.column_default !== String(attr.defaultValue)) return reject()
            if (typeof attr.defaultValue === "number" && Number(column.column_default?.split("::")[0]) !== attr.defaultValue) return reject()
            if (typeof attr.defaultValue === "string" && !column.column_default?.startsWith(`'${attr.defaultValue.replace(/'/g, "''")}'`)) return reject()
            if (!attr.autoIncrement && attr.defaultValue === undefined && column.column_default !== null) return reject()
            if (attr.defaultValue === null && column.column_default !== null && !column.column_default?.startsWith("NULL")) return reject()
            if (attr.references) {
                const reference = attr.references as any
                const target = typeof reference.model === "string" ? reference.model : reference.model.tableName
                if (!constraints.some(row => row.table_name === table && row.kind === "f" && row.validated
                    && JSON.stringify(row.keys) === JSON.stringify([field]) && row.target_table === target && row.target_schema === "public"
                    && JSON.stringify(row.target_keys) === JSON.stringify([reference.key ?? "id"])
                    && row.delete_action === action(attr.onDelete) && row.update_action === action(attr.onUpdate))) return reject()
            }
            if (attr.unique === true && !indexes.some(row => row.table_name === table && row.valid && row.is_unique && JSON.stringify(row.keys.map(normalized)) === JSON.stringify([normalized(field)]))) return reject()
        }
        const primary = attrs.filter(attr => attr.primaryKey).map(attr => attr.field)
        if (!constraints.some(row => row.table_name === table && row.kind === "p" && JSON.stringify(row.keys) === JSON.stringify(primary))) return reject()
        for (const group of new Set(attrs.map(attr => attr.unique).filter(value => typeof value === "string"))) {
            const keys = attrs.filter(attr => attr.unique === group).map(attr => normalized(attr.field!)).sort()
            if (!indexes.some(row => row.table_name === table && row.valid && row.is_unique && JSON.stringify(row.keys.map(normalized).sort()) === JSON.stringify(keys))) return reject()
        }
        for (const index of model.options.indexes ?? []) {
            const actual = indexes.find(row => row.table_name === table && row.name === index.name)
            const keys = (index.fields ?? []).map((field: any) => typeof field === "string" ? field : field.fn ? `${field.fn}(${field.args.map((arg: any) => arg.col).join(",")})` : field.attribute ?? field.name)
            if (!actual || !actual.valid || actual.is_unique !== (index.unique === true) || JSON.stringify(actual.keys.map(normalized)) !== JSON.stringify(keys.map(normalized))) return reject()
        }
    }
    if (!indexes.some(row => row.table_name === "customQuotes" && row.name === "customQuotes_source_variant_idx" && row.valid
        && JSON.stringify(row.keys.map(normalized)) === JSON.stringify(["sourceproductvariantid"]))) return reject()
    const checks: Record<string, string> = {
        packaging_classification_valid: "classification = ANY (ARRAY['specific','generic'])",
        packagings_consumption_defaults_check: "(defaultQuantityBasis IS NULL AND defaultQuantityValue IS NULL) OR (packagingRole='pallet' AND defaultQuantityBasis IS NOT NULL AND defaultQuantityValue IS NOT NULL AND defaultQuantityValue>0 AND defaultQuantityValue<=99999999.99)",
    }
    for (const [name, definition] of Object.entries(checks)) {
        if (!constraints.some(row => row.table_name === "packagings" && row.name === name && row.kind === "c" && row.validated && predicateContract(row.definition) === predicateContract(definition))) return reject()
    }
    const { rows: triggers } = await client.query(`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,t.tgtype AS trigger_type,t.tgnargs AS argument_count,
        (t.tgqual IS NULL) AS unconditional,
        ARRAY(SELECT a.attname::text FROM unnest(t.tgattr::smallint[]) k(id) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.id ORDER BY a.attnum) AS update_columns,
        pg_get_triggerdef(t.oid) AS definition,p.proname AS function_name,p.prosrc AS body,p.prosecdef AS security_definer,p.proconfig AS function_config,pn.nspname AS function_schema
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
        JOIN pg_namespace pn ON pn.oid=p.pronamespace
        WHERE n.nspname='public' AND NOT t.tgisinternal`)
    const sql = await fs.readFile(path.resolve(__dirname, "../../migrations/202610120002_packaging_classification.sql"), "utf8")
    for (const [name, table, fn, argument] of [
        ["guard_unit_packaging", "productVariantUnitMaterials", "guard_packaging_assignment", "unit"],
        ["guard_intermediate_packaging", "productVariantIntermediateMaterials", "guard_packaging_assignment", "intermediate"],
        ["guard_pallet_packaging", "productVariantPalletMaterials", "guard_packaging_assignment", "pallet"],
        ["guard_legacy_custom_packaging", "customQuotePackagingOptions", "guard_packaging_assignment", "legacy"],
        ["guard_packaging_reclassification", "packagings", "guard_packaging_reclassification", ""],
    ]) {
        const trigger = triggers.find(row => row.name === name && row.table_name === table)
        const body = sql.match(new RegExp(`CREATE FUNCTION ${fn}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1]
        if (!trigger || trigger.enabled !== "O" || trigger.function_name !== fn || trigger.function_schema !== "public"
            || trigger.security_definer || trigger.function_config !== null || !body
            || trigger.body.replace(/\r\n/g, "\n").trim() !== body.replace(/\r\n/g, "\n").trim()) return reject()
        const expectedColumns = argument ? ["packagingId"] : ["classification", "packagingRole"]
        if (trigger.trigger_type !== (argument ? 23 : 19) || !trigger.unconditional || trigger.argument_count !== (argument ? 1 : 0)
            || JSON.stringify([...trigger.update_columns].sort()) !== JSON.stringify(expectedColumns.sort())
            || (argument && !trigger.definition.includes(`'${argument}'`))) return reject()
    }
}

export async function assertBootstrapReady(client: InspectionClient): Promise<void> {
    const { rows: permissions } = await client.query("SELECT id,name FROM public.permissions WHERE \"isActive\"=true")
    if (PERMISSIONS.some(item => !permissions.some(row => row.name === item.name))) return reject()
    const { rows: admins } = await client.query(`SELECT u.id FROM public.users u JOIN public.roles r ON r.id=u.role_id
        WHERE u."isActive"=true AND r."isActive"=true AND r.name='${ADMIN_ROLE_NAME}'
        AND length(u.password)=60 AND left(u.password,4) IN ('$2a$','$2b$','$2y$')`)
    if (!admins.length) return reject()
    const { rows: grants } = await client.query(`SELECT p.name FROM public.role_permissions rp JOIN public.roles r ON r.id=rp.role_id
        JOIN public.permissions p ON p.id=rp.permission_id WHERE r.name='${ADMIN_ROLE_NAME}' AND p."isActive"=true`)
    if (PERMISSIONS.some(item => !grants.some(row => row.name === item.name))) return reject()
    const { rows: units } = await client.query('SELECT "displayName","unitType","baseFactor" FROM public.units WHERE "isActive"=true')
    if (UNIT_CATALOG.some(item => !units.some(row => row.unitType === item.unitType && Number(row.baseFactor) === item.baseFactor))) return reject()
}

export async function assertDatabaseReady(client: InspectionClient, sequelize: Sequelize): Promise<void> {
    await assertSchemaReady(client, sequelize)
    await assertBootstrapReady(client)
}
