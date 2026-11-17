import { randomUUID } from "node:crypto"
import { ownedPostgresEnabled, verifyOwnedPostgres } from "../shared/test-utils/ownedPostgres"

interface TestClient {
    connect(): Promise<void>
    end(): Promise<void>
    query(sql: string): Promise<{ rows: Record<string, unknown>[] }>
}
const { Client } = require("pg") as { Client: new (options: { connectionString: string }) => TestClient }
const { removeProspects } = require("../../scripts/remove-prospects.cjs") as { removeProspects(client: TestClient, database: string, apply?: boolean): Promise<{ applied: boolean }> }
const suite = ownedPostgresEnabled() ? describe : describe.skip

suite("retired prospect objects — owned PostgreSQL only", () => {
    let owner: TestClient
    const clients: TestClient[] = []
    beforeAll(async () => {
        owner = new Client({ connectionString: process.env.TEST_DATABASE_URL! })
        await owner.connect()
        await verifyOwnedPostgres(owner)
    })
    afterAll(async () => {
        for (const client of clients) await client.end()
        await owner?.end()
    })

    async function fixture() {
        await verifyOwnedPostgres(owner)
        const database = `remove_prospects_${randomUUID().replace(/-/g, "")}`
        const url = new URL(process.env.TEST_DATABASE_URL!)
        await owner.query(`CREATE DATABASE "${database}"`)
        url.pathname = `/${database}`
        const client = new Client({ connectionString: url.toString() })
        clients.push(client)
        await client.connect()
        await client.query(`CREATE TYPE public.enum_leads_status AS ENUM ('new','contacted');
            CREATE TABLE public.leads (id serial PRIMARY KEY,"fullName" text NOT NULL,"companyName" text NOT NULL,
                phone text,email text NOT NULL,"productLineInterest" text,notes text,status public.enum_leads_status,
                "createdAt" timestamptz,"updatedAt" timestamptz);
            CREATE TABLE public.permissions (id serial PRIMARY KEY,name text UNIQUE);
            CREATE TABLE public.role_permissions (id serial PRIMARY KEY,role_id integer,permission_id integer REFERENCES public.permissions(id));
            CREATE TABLE public.clients (id serial PRIMARY KEY,name text);
            CREATE TABLE public.quotes (id serial PRIMARY KEY,total numeric);
            INSERT INTO public.leads ("fullName","companyName",email) VALUES ('Synthetic contact','Synthetic company','test@example.invalid');
            INSERT INTO public.permissions (name) VALUES ('leads:view'),('leads:edit'),('leads:create'),('quotes:view');
            INSERT INTO public.role_permissions (role_id,permission_id) SELECT 1,id FROM public.permissions;
            INSERT INTO public.clients (name) VALUES ('Preserved customer');
            INSERT INTO public.quotes (total) VALUES (123.45);`)
        return { client, database }
    }

    test("inspection is read-only; apply removes all prospect records and grants while preserving quotation/client data", async () => {
        const { client, database } = await fixture()
        expect((await removeProspects(client, database)).applied).toBe(false)
        expect((await client.query("SELECT count(*)::int AS n FROM public.leads")).rows[0].n).toBe(1)
        expect((await removeProspects(client, database, true)).applied).toBe(true)
        expect((await client.query("SELECT to_regclass('public.leads') AS table,to_regtype('public.enum_leads_status') AS type,to_regclass('public.leads_id_seq') AS sequence")).rows[0]).toEqual({ table: null, type: null, sequence: null })
        expect((await client.query("SELECT name FROM public.permissions")).rows).toEqual([{ name: "quotes:view" }])
        expect((await client.query("SELECT count(*)::int AS n FROM public.role_permissions")).rows[0].n).toBe(1)
        expect((await client.query("SELECT name FROM public.clients")).rows).toEqual([{ name: "Preserved customer" }])
        expect((await client.query("SELECT total FROM public.quotes")).rows).toEqual([{ total: "123.45" }])
        await expect(removeProspects(client, database, true)).resolves.toMatchObject({ applied: true })
    })

    test("an incoming dependency stops removal and rolls back every permission and role-link deletion", async () => {
        const { client, database } = await fixture()
        await client.query("CREATE TABLE public.unexpected_reference (id serial PRIMARY KEY,contact_id integer REFERENCES public.leads(id))")
        await expect(removeProspects(client, database, true)).rejects.toBeDefined()
        expect((await client.query("SELECT count(*)::int AS n FROM public.leads")).rows[0].n).toBe(1)
        expect((await client.query("SELECT count(*)::int AS n FROM public.permissions")).rows[0].n).toBe(4)
        expect((await client.query("SELECT count(*)::int AS n FROM public.role_permissions")).rows[0].n).toBe(4)
    })

    test("an unrecognized table layout is rejected with its records intact", async () => {
        const { client, database } = await fixture()
        await client.query("ALTER TABLE public.leads ADD COLUMN unrelated_data text")
        await expect(removeProspects(client, database, true)).rejects.toThrow("does not match")
        expect((await client.query("SELECT count(*)::int AS n FROM public.leads")).rows[0].n).toBe(1)
        expect((await client.query("SELECT count(*)::int AS n FROM public.permissions")).rows[0].n).toBe(4)
    })
})
