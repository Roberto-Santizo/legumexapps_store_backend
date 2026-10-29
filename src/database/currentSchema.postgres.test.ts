import fs from "node:fs"
import path from "node:path"
import { Sequelize } from "sequelize-typescript"
const { Client } = require("pg")
import { databaseModels } from "./models"
import { createDatabaseSchema } from "./schemaCreation"
import { assertSchemaReady } from "./schemaReadiness"
import { currentModelContract } from "./schemaContract"
import { schemaChecks, schemaFunctions, schemaTriggers } from "./schemaExtras"
import { ownedPostgresEnabled, verifyOwnedPostgres } from "../shared/test-utils/ownedPostgres"

// Tests only the current model/complement contract. No earlier schema is loaded.
const suite = ownedPostgresEnabled() ? describe : describe.skip
suite("current Sequelize schema contract", () => {
    let owner: any, current: Sequelize
    beforeAll(async () => {
        owner = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: false })
        await owner.connect()
        await verifyOwnedPostgres(owner)
        const url = new URL(process.env.TEST_DATABASE_URL!)
        const id = url.username.match(/^test_owner_([a-f0-9]{32})$/)![1]
        const next = `current_schema_${id}`
        await owner.query(`CREATE DATABASE "${next}"`)
        url.pathname = `/${next}`
        current = new Sequelize(url.href, { dialect: "postgres", logging: false, models: databaseModels, dialectOptions: { ssl: false } })
        await current.transaction(async transaction => {
            try { await createDatabaseSchema(current,transaction) }
            catch(error) {
                const [constraints]=await current.query("SELECT c.relname,con.conname,con.contype,con.condeferrable,con.condeferred,con.connoinherit FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",{transaction})
                fs.writeFileSync(path.join(process.env.LEGUMEX_TEST_CLUSTER_DIR!,'..','creation-diagnostic.json'),JSON.stringify({constraints,contract:currentModelContract(current)},null,2))
                throw error
            }
        })
    }, 120000)
    afterAll(async () => { await current?.close(); await owner?.end() })

    test("all current tables, columns, keys, indexes and protections are created and verified", async () => {
        const queries = {
            columns: `SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2`,
            keys: `SELECT c.relname AS table_name,con.contype AS kind,con.conname AS name,pg_get_constraintdef(con.oid) AS definition,con.convalidated AS validated FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND con.contype IN ('p','f','u','c') ORDER BY 1,2,3`,
            indexes: `SELECT c.relname AS table_name,i.relname AS name,pg_get_indexdef(x.indexrelid) AS definition,x.indisunique AS unique,x.indisvalid AS valid,ARRAY(SELECT pg_get_indexdef(x.indexrelid,k,false) FROM generate_series(1,x.indnkeyatts) k) AS keys,pg_get_expr(x.indpred,x.indrelid) AS predicate FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1,2,4`,
            functions: `SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition,p.prosrc AS body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1`,
            triggers: `SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition,p.prosrc AS body,p.prosecdef AS security_definer,p.proconfig AS settings FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2`,
        }
        const result: Record<string, unknown> = {}
        for (const [name, sql] of Object.entries(queries)) {
            
            const [actual] = await current.query(sql)
            result[name] = actual
        }
        fs.writeFileSync(path.join(process.env.LEGUMEX_TEST_CLUSTER_DIR!, "..", "current-schema-catalog.json"), JSON.stringify(result, null, 2))
        const contract=currentModelContract(current)
        expect(contract).toHaveLength(49)
        expect((result.columns as any[])).toHaveLength(current.modelManager.models.reduce((sum,model)=>sum+Object.keys(model.rawAttributes).length,0))
        expect((result.keys as any[]).filter(row=>row.kind==='c')).toHaveLength(schemaChecks.length)
        expect(result.triggers).toHaveLength(schemaTriggers.length)
        expect((result.keys as any[]).filter(row=>row.kind==='c').map(row=>row.name).sort()).toEqual(schemaChecks.map(check=>check.name).sort())
        expect((result.functions as any[]).map(row=>row.name).sort()).toEqual(schemaFunctions.map(fn=>fn.name).sort())
        expect((result.indexes as any[]).map(row=>row.name).sort()).toEqual(contract.flatMap(model=>model.indexes.map(index=>index.name)).sort())
        for(const model of contract) for(const unique of model.unique) expect((result.keys as any[])).toEqual(expect.arrayContaining([expect.objectContaining({table_name:model.table,name:unique.name,kind:'u'})]))
        expect(databaseModels).toHaveLength(49)
        await assertSchemaReady({ query: async sql => ({ rows: (await current.query(sql))[0] }) }, current)
    })
    test.each([
        ['additional rewrite rule silently dropping users', 'CREATE RULE unauthorized_rule AS ON INSERT TO public.users DO INSTEAD NOTHING'],
        ['modified rewrite rule', 'CREATE RULE unauthorized_rule AS ON INSERT TO public.users DO INSTEAD NOTHING; CREATE OR REPLACE RULE unauthorized_rule AS ON INSERT TO public.users DO ALSO NOTIFY unauthorized'],
        ['RLS hiding quotes', 'ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY; CREATE POLICY unauthorized_policy ON public.quotes USING (false)'],
        ['enabled RLS', 'ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY'],
        ['forced RLS', 'ALTER TABLE public.categories FORCE ROW LEVEL SECURITY'],
        ['dormant RLS policy', 'CREATE POLICY unauthorized_policy ON public.categories USING (false)'],
        ['external event trigger', "CREATE SCHEMA event_test; CREATE FUNCTION event_test.handler() RETURNS event_trigger LANGUAGE plpgsql AS $$BEGIN RETURN; END$$; CREATE EVENT TRIGGER unauthorized_event ON ddl_command_end EXECUTE FUNCTION event_test.handler()"],
        ['disabled external event trigger', "CREATE SCHEMA event_test; CREATE FUNCTION event_test.handler() RETURNS event_trigger LANGUAGE plpgsql AS $$BEGIN RETURN; END$$; CREATE EVENT TRIGGER unauthorized_event ON ddl_command_end EXECUTE FUNCTION event_test.handler(); ALTER EVENT TRIGGER unauthorized_event DISABLE"],
        ['changed column collation', 'ALTER TABLE public.categories ALTER COLUMN "displayName" TYPE varchar(80) COLLATE "C"'],
        ['numeric CHECK altered by a rounding cast',"ALTER TABLE public.\"unprocessedRawMaterials\" DROP CONSTRAINT \"unprocessedRawMaterials_costPerPound_check\"; ALTER TABLE public.\"unprocessedRawMaterials\" ADD CONSTRAINT \"unprocessedRawMaterials_costPerPound_check\" CHECK(btrim(code)<>'' AND btrim(\"displayName\")<>'' AND \"costPerPound\"::integer>=0)"],
        ['changed function cost','ALTER FUNCTION public.guard_packaging_reclassification() COST 101'],
        ['changed serial default',"ALTER TABLE public.categories ALTER COLUMN id SET DEFAULT nextval('users_id_seq'::regclass)"],
        ['additional enum',"CREATE TYPE public.unauthorized_enum AS ENUM ('x')"],
        ['additional sequence','CREATE SEQUENCE public.unauthorized_sequence'],
        ['additional table','CREATE TABLE public.unauthorized_table(id integer)'],
        ['additional view','CREATE VIEW public.unauthorized_view AS SELECT 1 AS id'],
        ['additional CHECK','ALTER TABLE public.packagings ADD CONSTRAINT unauthorized_check CHECK("unitCost"<1)'],
        ['additional unique index','CREATE UNIQUE INDEX unauthorized_unique ON public.categories("displayName")'],
        ['additional ordinary index','CREATE INDEX unauthorized_index ON public.categories("displayName")'],
        ['additional UNIQUE constraint','ALTER TABLE public.categories ADD CONSTRAINT unauthorized_unique UNIQUE("displayName")'],
        ['additional function',"CREATE FUNCTION public.unauthorized_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1'"],
        ['additional trigger','CREATE TRIGGER unauthorized_trigger BEFORE INSERT ON public.packagings FOR EACH ROW EXECUTE FUNCTION public.guard_packaging_reclassification()'],
        ['changed function volatility','ALTER FUNCTION public.guard_packaging_reclassification() IMMUTABLE'],
        ['renamed CHECK','ALTER TABLE public.packagings RENAME CONSTRAINT packaging_classification_valid TO unauthorized_check'],
        ['renamed UNIQUE','ALTER TABLE public.packagings RENAME CONSTRAINT packagings_code_key TO unauthorized_unique'],
        ['renamed FK','ALTER TABLE public.representative_clients RENAME CONSTRAINT "representative_clients_clientId_fkey" TO unauthorized_fk'],
        ['changed index method','DROP INDEX representative_clients_client_idx; CREATE INDEX representative_clients_client_idx ON public.representative_clients USING hash("clientId")'],
    ])('rejects %s in a read-only inspection and restores after rollback',async(_name,sql)=>{
        await expect(current.transaction(async transaction=>{
            await current.query(sql,{transaction})
            const client={query:async(sql:string)=>({rows:(await current.query(sql,{transaction}))[0]})}
            await expect(assertSchemaReady(client,current)).rejects.toThrow('Database schema incompatible')
            throw Error('Intentional test rollback')
        })).rejects.toThrow('Intentional test rollback')
        await assertSchemaReady({query:async sql=>({rows:(await current.query(sql))[0]})},current)
    })

})
