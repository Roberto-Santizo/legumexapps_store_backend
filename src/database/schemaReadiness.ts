import type { Sequelize } from "sequelize-typescript"
import { currentModelContract, constraintName } from "./schemaContract"
import { schemaChecks, schemaFunctions, schemaTriggers } from "./schemaExtras"
import { ADMIN_ROLE_NAME, PERMISSIONS } from "../features/accessControl/permissions/constants/accessControlPolicy"
import { UNIT_CATALOG } from "../features/unit/constants/unitCatalog"
import { predicateContract } from "./schemaPredicate"
import type { DatabaseRolePolicy } from "../config/databaseRolePolicy"

export interface InspectionClient { query(sql: string): Promise<{ rows: any[] }> }
export class SchemaCompatibilityError extends Error {
    constructor(readonly issue: string) { super(`Database schema incompatible: ${issue}`); this.name = "SchemaCompatibilityError" }
}
const reject = (issue = "constraint, index, access or PostgreSQL complement mismatch"): never => { throw new SchemaCompatibilityError(issue) }
const indexKey = (value: string) => value.replace(/::(?:text|character varying)/g, "").replace(/[\s"()]/g, "")
const normalized = (value: string) => value.toLowerCase().replace(/::(?:text|character varying)/g, "").replace(/[\s"()]/g, "")

/** Catalog SELECTs are deliberately not filtered by ownership or information_schema visibility. */
export async function assertPostgresCapabilities(client: InspectionClient): Promise<void> {
    const { rows } = await client.query("SELECT current_setting('server_version_num') AS version")
    if (rows.length !== 1 || !/^\d+$/.test(String(rows[0].version)) || Number(rows[0].version) < 150000)
        return reject("PostgreSQL 15 or newer is required")
}

export async function assertNoUnexpectedBehavior(client: InspectionClient): Promise<void> {
    try {
        const { rows: access } = await client.query(`SELECT bool_and(has_table_privilege(current_user,catalog,'SELECT')) AS readable
            FROM unnest(ARRAY['pg_catalog.pg_class','pg_catalog.pg_namespace','pg_catalog.pg_rewrite',
                'pg_catalog.pg_policy','pg_catalog.pg_event_trigger','pg_catalog.pg_attribute','pg_catalog.pg_type']) AS catalog`)
        if (access.length !== 1 || access[0].readable !== true) return reject("required PostgreSQL catalogs are not readable")
        const { rows } = await client.query(`SELECT 'rule' AS kind FROM pg_catalog.pg_rewrite r
            JOIN pg_catalog.pg_class c ON c.oid=r.ev_class JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
            UNION ALL SELECT 'row security' FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND (c.relrowsecurity OR c.relforcerowsecurity)
            UNION ALL SELECT 'RLS policy' FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
                JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
            UNION ALL SELECT 'event trigger' FROM pg_catalog.pg_event_trigger
            UNION ALL SELECT 'column collation' FROM pg_catalog.pg_attribute a
                JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
                WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.attcollation<>t.typcollation`)
        if (rows.length) return reject(`unexpected PostgreSQL behavior: ${[...new Set(rows.map(row=>row.kind))].join(', ')}`)
    } catch (error) {
        if (error instanceof SchemaCompatibilityError) throw error
        return reject("required PostgreSQL behavioral metadata could not be inspected")
    }
}

export async function assertApplicationRole(client: InspectionClient, policy: DatabaseRolePolicy = "restricted"): Promise<void> {
    const { rows } = await client.query(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
        has_schema_privilege(current_user,'public','CREATE') AS schema_create,
        has_table_privilege(current_user,'public.users','TRUNCATE') AS table_truncate,
        current_setting('transaction_read_only') AS transaction_mode
        FROM pg_roles r WHERE r.rolname=current_user`)
    const flags = ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "schema_create", "table_truncate"]
    if (!["restricted", "owner"].includes(policy) || rows.length !== 1 || rows[0].transaction_mode !== "on"
        || flags.some(key => typeof rows[0][key] !== "boolean")) return reject()
    const forbidden = policy === "owner" ? ["rolsuper", "rolreplication", "rolbypassrls"] : flags
    if (forbidden.some(key => rows[0][key] !== false)) return reject()
}

/** SELECT-only validation; callers supply a read-only transaction on their own connection. */
export async function assertSchemaReady(client: InspectionClient, sequelize: Sequelize): Promise<void> {
    await assertPostgresCapabilities(client)
    await assertNoUnexpectedBehavior(client)
    const contract = currentModelContract(sequelize)
    const { rows: tables } = await client.query("SELECT c.relname AS name,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')")
    if (tables.length !== contract.length || tables.some(row => row.relkind !== 'r' || !contract.some(model => model.table === row.name))) return reject("unexpected or missing application tables")
    const expectedSequences=sequelize.modelManager.models.flatMap(model=>Object.values(model.rawAttributes).filter(attr=>attr.autoIncrement).map(attr=>({name:constraintName(String(model.getTableName()),[attr.field!],'seq'),table:String(model.getTableName()),field:attr.field!})))
    const {rows:sequences}=await client.query(`SELECT s.relname AS name,t.relname AS table_name,a.attname AS field FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace
        LEFT JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i') LEFT JOIN pg_class t ON t.oid=d.refobjid LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
        WHERE n.nspname='public' AND s.relkind='S'`)
    if(sequences.length!==expectedSequences.length || sequences.some(row=>!expectedSequences.some(expected=>expected.name===row.name&&expected.table===row.table_name&&expected.field===row.field))) return reject('unexpected, missing or incorrectly owned sequences')
    const expectedEnums=sequelize.modelManager.models.flatMap(model=>Object.values(model.rawAttributes).filter(attr=>(attr.type as any).values).map(attr=>`enum_${String(model.getTableName())}_${attr.field}`))
    const {rows:types}=await client.query(`SELECT t.typname,t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND (t.typtype IN ('e','d','r','m') OR (t.typtype='b' AND t.typelem=0))`)
    if(types.length!==expectedEnums.length || types.some(row=>row.typtype!=='e'||!expectedEnums.includes(row.typname))) return reject('unexpected or missing application types')
    const { rows: columns } = await client.query(`SELECT c.relname AS table_name, a.attname AS column_name,
        format_type(a.atttypid,a.atttypmod) AS sql_type, a.attnotnull AS not_null,
        pg_get_expr(d.adbin,d.adrelid) AS column_default,pg_get_serial_sequence(format('%I.%I','public',c.relname),a.attname) AS owned_sequence,
        ARRAY(SELECT e.enumlabel::text FROM pg_enum e WHERE e.enumtypid=a.atttypid ORDER BY e.enumsortorder) AS enum_values
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`)
    const { rows: constraints } = await client.query(`SELECT c.relname AS table_name, con.conname AS name, con.contype AS kind,
        con.convalidated AS validated,con.condeferrable AS deferrable,con.condeferred AS deferred,con.connoinherit AS no_inherit, pg_get_constraintdef(con.oid) AS definition,
        ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(id,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.id ORDER BY k.ord) AS keys,
        r.relname AS target_table, rn.nspname AS target_schema,
        ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(id,ord) JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=k.id ORDER BY k.ord) AS target_keys,
        con.confmatchtype AS match_type, con.confdeltype AS delete_action, con.confupdtype AS update_action
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_class r ON r.oid=con.confrelid LEFT JOIN pg_namespace rn ON rn.oid=r.relnamespace WHERE n.nspname='public'`)
    const { rows: indexes } = await client.query(`SELECT c.relname AS table_name, i.relname AS name, x.indisunique AS is_unique,x.indnullsnotdistinct AS nulls_not_distinct,am.amname AS method,x.indnatts-x.indnkeyatts AS included,x.indoption::smallint[] AS ordering,
        NOT EXISTS (SELECT 1 FROM unnest(x.indclass::oid[]) op(oid) JOIN pg_opclass cl ON cl.oid=op.oid WHERE NOT cl.opcdefault) AS default_opclasses,
        (x.indisvalid AND x.indisready AND x.indislive AND x.indpred IS NULL) AS valid,
        ARRAY(SELECT pg_get_indexdef(x.indexrelid,k,false) FROM generate_series(1,x.indnkeyatts) k) AS keys
        FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_am am ON am.oid=i.relam WHERE n.nspname='public'`)
    const action = (value?: string) => ({ CASCADE: "c", RESTRICT: "r", "SET NULL": "n", "NO ACTION": "a", "SET DEFAULT": "d" }[value ?? "NO ACTION"])
    for (const model of sequelize.modelManager.models) {
        const table = String(model.getTableName())
        if (!columns.some(row => row.table_name === table)) return reject(`missing table ${table}`)
        const attrs = Object.values(model.rawAttributes)
        const expectedFields = new Set(attrs.map(attr => attr.field))
        if (columns.some(column => column.table_name === table && !expectedFields.has(column.column_name)))
            return reject(`unexpected columns in ${table}; explicit schema review required`)
        for (const attr of attrs) {
            const field = attr.field!
            const column = columns.find(row => row.table_name === table && row.column_name === field)
            if (!column) return reject(`missing column ${table}.${field}`)
            if (column.not_null !== (attr.primaryKey === true || attr.allowNull === false)) return reject(`nullability mismatch ${table}.${field}`)
            const type = attr.type as any
            if (type.values) {
                if (column.sql_type.replace(/"/g, "") !== `enum_${table}_${field}` || JSON.stringify(column.enum_values) !== JSON.stringify(type.values)) return reject()
            } else {
                const expected = type.toSql().toLowerCase().replace(/^varchar/, "character varying").replace(/^decimal/, "numeric")
                if (normalized(column.sql_type) !== normalized(expected)) return reject(`type mismatch ${table}.${field}; expected ${expected}`)
            }
            if (attr.autoIncrement) {
                const sequence=constraintName(table,[field],'seq')
                const actualDefault=column.column_default?.replace(/"/g,'').replace(/public\./g,'')
                const owned=column.owned_sequence?.replace(/"/g,'').replace(/^public\./,'')
                if(owned!==sequence || actualDefault!==`nextval('${sequence}'::regclass)`) return reject(`sequence/default mismatch ${table}.${field}`)
            }
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
    for (const expected of contract) {
        const keys = constraints.filter(row => row.table_name === expected.table)
        const expectedNames = [constraintName(expected.table, [], 'pkey'), ...expected.unique.map(key=>key.name), ...expected.foreign.map(key=>key.name), ...schemaChecks.filter(check=>check.table===expected.table).map(check=>check.name)]
        if (keys.length !== expectedNames.length || keys.some(row=>!expectedNames.includes(row.name) || !row.validated || row.deferrable || row.deferred || row.no_inherit!==(row.kind!=='c'))) return reject(`constraint inventory mismatch ${expected.table}`)
        for (const unique of expected.unique) if (!keys.some(row=>row.name===unique.name && row.kind==='u' && JSON.stringify(row.keys)===JSON.stringify(unique.fields))) return reject(`UNIQUE mismatch ${expected.table}.${unique.name}`)
        for (const foreign of expected.foreign) if (!keys.some(row=>row.name===foreign.name && row.kind==='f' && row.match_type==='s' && JSON.stringify(row.keys)===JSON.stringify([foreign.field]) && row.target_table===foreign.target && row.target_schema==='public' && JSON.stringify(row.target_keys)===JSON.stringify([foreign.key]) && row.delete_action===action(foreign.onDelete) && row.update_action===action(foreign.onUpdate))) return reject(`foreign key mismatch ${expected.table}.${foreign.name}`)
        const actualIndexes=indexes.filter(row=>row.table_name===expected.table)
        if (actualIndexes.length!==expected.indexes.length) return reject(`index inventory mismatch ${expected.table}`)
        for (const index of expected.indexes) {
            const actual=actualIndexes.find(row=>row.name===index.name)
            const fields=(index.fields??[]).map((field:any)=>typeof field==='string'?field:field.fn?`${field.fn}(${field.args.map((arg:any)=>arg.col).join(',')})`:field.attribute??field.name)
            const order=(index.fields??[]).map((field:any)=>typeof field==='object' && field.order==='DESC'?3:0)
            if (!actual || !actual.valid || actual.is_unique!==(index.unique===true) || actual.nulls_not_distinct!==false || actual.method!==((index as any).using??'btree') || actual.included!==0 || !actual.default_opclasses || JSON.stringify(actual.ordering)!==JSON.stringify(order) || JSON.stringify(actual.keys.map(indexKey))!==JSON.stringify(fields.map(indexKey))) return reject(`index definition mismatch ${expected.table}.${index.name}`)
        }
    }
    for (const check of schemaChecks) {
        const expected = check.expression.replace(/([\w".]+)\s+IN\s*\(([^()]+)\)/gi, "$1 = ANY (ARRAY[$2])")
        if (!constraints.some(row => row.table_name === check.table && row.name === check.name && row.kind === "c" && row.validated && predicateContract(row.definition) === predicateContract(expected))) return reject(`CHECK mismatch ${check.table}.${check.name}`)
    }
    const { rows: triggers } = await client.query(`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,t.tgtype AS trigger_type,t.tgnargs AS argument_count,encode(t.tgargs,'hex') AS arguments_hex,
        (t.tgqual IS NULL) AS unconditional,
        ARRAY(SELECT a.attname::text FROM unnest(t.tgattr::smallint[]) k(id) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.id ORDER BY a.attnum) AS update_columns,
        pg_get_triggerdef(t.oid) AS definition,p.proname AS function_name,p.prosrc AS body,p.prosecdef AS security_definer,p.proconfig AS function_config,pn.nspname AS function_schema
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
        JOIN pg_namespace pn ON pn.oid=p.pronamespace
        WHERE n.nspname='public' AND NOT t.tgisinternal`)
    if (triggers.length!==schemaTriggers.length) return reject('unexpected or missing triggers')
    const { rows: functions } = await client.query(`SELECT p.proname AS name,p.pronargs,p.prosrc AS body,p.prosecdef,p.proconfig,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.prokind,p.procost,p.prorows,p.proretset,p.pronargdefaults,format_type(p.prorettype,NULL) AS returns,l.lanname AS language FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public'`)
    if (functions.length!==schemaFunctions.length) return reject('unexpected or missing PostgreSQL functions')
    for (const expected of schemaFunctions) {
        const actual=functions.find(row=>row.name===expected.name)
        if (!actual || actual.pronargs!==0 || actual.returns!=='trigger' || actual.language!=='plpgsql' || actual.prosecdef || actual.proconfig!==null || actual.provolatile!=='v' || actual.proisstrict || actual.proleakproof || actual.proparallel!=='u' || actual.prokind!=='f' || actual.procost!==100 || actual.prorows!==0 || actual.proretset || actual.pronargdefaults!==0 || actual.body.replace(/\r\n/g,'\n').trim()!==expected.body.replace(/\r\n/g,'\n').trim()) return reject(`function definition mismatch ${expected.name}`)
    }
    for (const expected of schemaTriggers) {
        const trigger = triggers.find(row => row.name === expected.name && row.table_name === expected.table)
        const fn = schemaFunctions.find(row => row.name === expected.functionName)!
        if (!trigger || trigger.enabled !== "O" || trigger.function_name !== fn.name || trigger.function_schema !== "public"
            || trigger.security_definer || trigger.function_config !== null
            || trigger.body.replace(/\r\n/g, "\n").trim() !== fn.body.replace(/\r\n/g, "\n").trim()) return reject(`trigger/function mismatch ${expected.table}.${expected.name}`)
        const updateColumns = expected.event.includes("UPDATE OF") ? expected.event.split("UPDATE OF")[1].trim().split(",").map(field => field.trim().replace(/"/g, "")).sort() : []
        const args = expected.arguments ? expected.arguments.split(",").map(value => value.trim()) : []
        if (trigger.trigger_type !== (expected.event.includes("INSERT") ? 23 : 19) || !trigger.unconditional
            || trigger.argument_count !== args.length || trigger.arguments_hex !== Buffer.from(args.map(value=>value.slice(1,-1).replace(/''/g,"'")+"\0").join("")).toString("hex") || JSON.stringify([...trigger.update_columns].sort()) !== JSON.stringify(updateColumns)
            || args.some(argument => !trigger.definition.includes(argument))) return reject(`trigger events mismatch ${expected.table}.${expected.name}`)
    }
}

async function assertBootstrapReady(client: InspectionClient): Promise<void> {
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
    const {rows:access}=await client.query(`SELECT bool_and(has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
        AND has_table_privilege(current_user,c.oid,'UPDATE') AND has_table_privilege(current_user,c.oid,'DELETE')) AS tables_allowed
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`)
    const {rows:sequenceAccess}=await client.query(`SELECT bool_and(has_sequence_privilege(current_user,c.oid,'USAGE') AND has_sequence_privilege(current_user,c.oid,'SELECT')) AS sequences_allowed
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'`)
    if(access[0]?.tables_allowed!==true || sequenceAccess[0]?.sequences_allowed!==true) return reject('application table or sequence privileges incomplete')
    await assertBootstrapReady(client)
}
