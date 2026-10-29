import { randomUUID } from "node:crypto"
import { Sequelize } from "sequelize-typescript"
import { databaseModels } from "./models"
import { bootstrapDatabase, inspectEmptyDatabase } from "./bootstrap"
import { assertDatabaseReady } from "./schemaReadiness"
import { ownedPostgresEnabled, verifyOwnedPostgres } from "../shared/test-utils/ownedPostgres"
const { Client } = require("pg")
const credentials={username:"initial-admin",password:"Synthetic-password-2026"}
const suite=ownedPostgresEnabled()?describe:describe.skip

suite("initialization only on an empty owned local database",()=>{
    let owner:any
    const opened:Sequelize[]=[]
    beforeAll(async()=>{owner=new Client({connectionString:process.env.TEST_DATABASE_URL,ssl:false});await owner.connect();await verifyOwnedPostgres(owner)})
    afterAll(async()=>{for(const db of opened)await db.close();await owner?.end()})
    async function fresh() {
        await verifyOwnedPostgres(owner)
        const url=new URL(process.env.TEST_APP_DATABASE_URL!)
        const name=`initialize_${randomUUID().replace(/-/g,'')}`
        await owner.query(`CREATE DATABASE "${name}" OWNER "${url.username}"`)
        url.pathname=`/${name}`
        const db=new Sequelize(url.href,{dialect:"postgres",logging:false,models:databaseModels,dialectOptions:{ssl:false}})
        opened.push(db)
        return {db,url}
    }
    const query=async(db:Sequelize,sql:string)=>(await db.query(sql))[0] as any[]

    test("normal non-superuser credentials initialize all models and references atomically",async()=>{
        const {db}=await fresh()
        const flags=(await query(db,"SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user"))[0]
        expect(flags).toEqual({rolsuper:false,rolcreatedb:false,rolcreaterole:false})
        await bootstrapDatabase(db,credentials)
        expect((await query(db,"SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"))[0].n).toBe(49)
        expect((await query(db,'SELECT count(*)::int AS n FROM permissions'))[0].n).toBe(87)
        expect((await query(db,'SELECT count(*)::int AS n FROM units'))[0].n).toBe(10)
        await assertDatabaseReady({query:async sql=>({rows:await query(db,sql)})},db)
        const users=await query(db,'SELECT id,username,password FROM users')
        await expect(bootstrapDatabase(db,credentials)).rejects.toThrow('empty database')
        expect(await query(db,'SELECT id,username,password FROM users')).toEqual(users)
    },60000)

    test.each([
        ['empty table','CREATE TABLE public.existing(id integer)'],
        ['table with data','CREATE TABLE public.existing(id integer); INSERT INTO public.existing VALUES(7)'],
        ['enum',"CREATE TYPE public.existing AS ENUM ('keep')"],
        ['function',"CREATE FUNCTION public.existing() RETURNS integer LANGUAGE sql AS 'SELECT 7'"],
        ['sequence','CREATE SEQUENCE public.existing'],
        ['another schema','CREATE SCHEMA existing'],
        ['user schema beginning with pg','CREATE SCHEMA pgx_existing'],
        ['collation','CREATE COLLATION public.existing FROM "C"'],
        ['large object',"SELECT lo_from_bytea(0,decode('abcd','hex'))"],
    ])('refuses %s without adopting or deleting it',async(_name,sql)=>{
        const {db}=await fresh();await db.query(sql)
        const catalog="SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1"
        const before=await query(db,catalog)
        await expect(bootstrapDatabase(db,credentials)).rejects.toThrow('empty database')
        expect(await query(db,catalog)).toEqual(before)
        if(_name==='table with data')expect(await query(db,'SELECT * FROM public.existing')).toEqual([{id:7}])
    })

    test("insufficient CREATE privilege fails before writing tables",async()=>{
        const {db}=await fresh()
        await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
        // An ordinary login different from this database's owner has no CREATE grant.
        const root=new URL(process.env.TEST_DATABASE_URL!),id=root.username.match(/^test_owner_([a-f0-9]{32})$/)![1]
        const name=`permission_${id}`
        await owner.query(`CREATE DATABASE "${name}"`)
        const url=new URL(process.env.TEST_APP_DATABASE_URL!);url.pathname=`/${name}`
        const limited=new Sequelize(url.href,{dialect:'postgres',logging:false,models:databaseModels,dialectOptions:{ssl:false}});opened.push(limited)
        await expect(bootstrapDatabase(limited,credentials)).rejects.toThrow('USAGE/CREATE')
        expect((await query(limited,"SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"))[0].n).toBe(0)
    })

    test("failure after schema creation rolls back tables and initial reference data",async()=>{
        const {db}=await fresh(),original=db.query.bind(db)
        const spy=jest.spyOn(db,'query').mockImplementation((async(sql:any,options:any)=>{
            if(typeof sql==='string' && sql.startsWith('INSERT INTO public.units'))throw Error('Synthetic failure before initial units')
            return original(sql,options)
        }) as any)
        try{await expect(bootstrapDatabase(db,credentials)).rejects.toThrow('Synthetic failure')}
        finally{spy.mockRestore()}
        expect((await query(db,"SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"))[0].n).toBe(0)
        await bootstrapDatabase(db,credentials)
    },60000)

    test("another initializer blocks without a special PostgreSQL role",async()=>{
        const {db,url}=await fresh(),lock=new Client({connectionString:url.href,ssl:false});await lock.connect()
        try{
            await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(174227,1)')
            await expect(bootstrapDatabase(db,credentials)).rejects.toThrow('Another initialization')
        }finally{await lock.query('ROLLBACK');await lock.end()}
        expect((await query(db,"SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"))[0].n).toBe(0)
    })

    test("destination mismatch is rejected immediately before schema creation",async()=>{
        const {db}=await fresh()
        const identity=await inspectEmptyDatabase({query:async sql=>({rows:await query(db,sql)})})
        await expect(bootstrapDatabase(db,credentials,{...identity,database_oid:'0'})).rejects.toThrow('destination changed')
        expect((await query(db,"SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"))[0].n).toBe(0)
    })
})
