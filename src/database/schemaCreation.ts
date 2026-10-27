import type { Sequelize } from "sequelize-typescript";
import { literal, QueryTypes, type Transaction } from "sequelize";
import { schemaChecks, schemaFunctions, schemaTriggers } from "./schemaExtras";
import { assertSchemaReady, assertPostgresCapabilities, assertNoUnexpectedBehavior } from "./schemaReadiness";

class NonEmptyDatabaseError extends Error {
    constructor(readonly objects: { type: string; schema: string | null; name: string | null }[]) {
        super("Initialization requires an empty database; existing objects and data are never modified");
        this.name = "NonEmptyDatabaseError";
    }
}

/** Refuses every existing user object; never adopts or repairs an existing database. */
export async function assertEmptyDatabase(client: { query(sql: string): Promise<{ rows: any[] }> }): Promise<void> {
    const { rows } = await client.query(`SELECT DISTINCT i.type,i.schema,COALESCE(i.name,i.identity) AS name FROM pg_catalog.pg_depend d
        CROSS JOIN LATERAL pg_catalog.pg_identify_object(d.classid,d.objid,d.objsubid) i
        WHERE d.refclassid='pg_catalog.pg_namespace'::regclass AND d.refobjid='public'::regnamespace
        UNION ALL SELECT 'schema',NULL,nspname FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname !~ '^pg_'
        UNION ALL SELECT 'extension',NULL,extname FROM pg_catalog.pg_extension WHERE extname<>'plpgsql'
        UNION ALL SELECT 'large object',NULL,oid::text FROM pg_catalog.pg_largeobject_metadata`);
    if (rows.length) throw new NonEmptyDatabaseError(rows);
}

/** Creation only. Never updates an existing schema; callers own authorization and transaction. */
export async function createDatabaseSchema(db: Sequelize, transaction: Transaction): Promise<void> {
    const inspector = { query: async (sql: string) => ({ rows: await db.query(sql, { type: QueryTypes.SELECT, transaction }) as any[] }) };
    await assertPostgresCapabilities(inspector);
    await assertNoUnexpectedBehavior(inspector);
    await assertEmptyDatabase(inspector);
    const options = { force: false, alter: false, transaction };
    await db.sync(options);
    await installPostgresComplements(db, transaction);
    await assertSchemaReady(inspector, db);
}

/** Reinstall current complements after development alter; never drops tables or types. */
export async function installPostgresComplements(db: Sequelize, transaction: Transaction): Promise<void> {
    const qi = db.getQueryInterface();
    const constraints = await db.query("SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace", {type:QueryTypes.SELECT,transaction}) as {conname:string}[];
    for (const check of schemaChecks)
        if (!constraints.some(row=>row.conname===check.name))
        await qi.addConstraint(check.table, { fields: [], type: "check", name: check.name, where: literal(check.expression), transaction });
    for (const fn of schemaFunctions)
        await db.query(`CREATE OR REPLACE FUNCTION public.${fn.name}() RETURNS trigger LANGUAGE plpgsql AS $$${fn.body}$$;`, { transaction });
    for (const trigger of schemaTriggers) {
        await db.query(`DROP TRIGGER IF EXISTS ${trigger.name} ON public."${trigger.table}"`, { transaction });
        await db.query(`CREATE TRIGGER ${trigger.name} ${trigger.event} ON public."${trigger.table}" FOR EACH ROW EXECUTE FUNCTION public.${trigger.functionName}(${trigger.arguments});`, { transaction });
    }
}

