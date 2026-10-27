import { schemaTriggers } from "./schemaExtras"
import { randomUUID } from "node:crypto"
import { Sequelize } from "sequelize-typescript"
import { databaseModels } from "./models"
import { synchronizeDevelopment } from "./developmentSync"
import { runSeeders } from "./seeders"
import { ownedPostgresEnabled, verifyOwnedPostgres } from "../shared/test-utils/ownedPostgres"
const { Client } = require("pg")
const suite = ownedPostgresEnabled() ? describe : describe.skip

suite("development startup initial data on owned PostgreSQL",()=>{
    let owner:any,db:Sequelize
    beforeAll(async()=>{
        owner=new Client({connectionString:process.env.TEST_DATABASE_URL,ssl:false})
        await owner.connect();await verifyOwnedPostgres(owner)
        const url=new URL(process.env.TEST_APP_DATABASE_URL!)
        const name=`dev_seed_${randomUUID().replace(/-/g,'')}`
        await owner.query(`CREATE DATABASE "${name}" OWNER "${url.username}"`)
        url.pathname=`/${name}`
        db=new Sequelize(url.href,{dialect:'postgres',logging:false,models:databaseModels,dialectOptions:{ssl:false}})
    })
    afterAll(async()=>{await db?.close();await owner?.end()})
    const rows=async(sql:string)=>(await db.query(sql))[0] as any[]
    const triggers=()=>rows("SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal")

    test("batch initialization preserves users, inactive permissions and custom units; failed alter restores triggers",async()=>{
        const previousUser=process.env.BOOTSTRAP_ADMIN_USERNAME,previousPassword=process.env.BOOTSTRAP_ADMIN_PASSWORD
        process.env.BOOTSTRAP_ADMIN_USERNAME='dev-admin'
        process.env.BOOTSTRAP_ADMIN_PASSWORD='Synthetic-development-password-2026'
        try {
            await db.query("CREATE TYPE public.enum_leads_status AS ENUM ('new','contacted')")
            await synchronizeDevelopment(db,'development')
            await runSeeders(db,{})
            expect(await rows('SELECT * FROM users')).toHaveLength(0)
            await runSeeders(db)
            const before=await rows('SELECT * FROM users')
            expect(before).toHaveLength(1)
            await db.query('UPDATE permissions SET "isActive"=false WHERE id=(SELECT min(id) FROM permissions)')
            await db.query('UPDATE units SET "displayName"=\'Local custom label\' WHERE id=(SELECT min(id) FROM units)')
            await db.query('DELETE FROM role_permissions WHERE permission_id=(SELECT min(id) FROM permissions)')
            await synchronizeDevelopment(db,'development')
            await runSeeders(db)
            expect(await rows('SELECT * FROM users')).toEqual(before)
            expect(await rows('SELECT count(*)::int AS n FROM permissions')).toEqual([{n:86}])
            expect(await rows('SELECT count(*)::int AS n FROM units')).toEqual([{n:10}])
            expect(await rows('SELECT count(*)::int AS n FROM role_permissions')).toEqual([{n:86}])
            expect(await rows('SELECT count(*)::int AS n FROM permissions WHERE NOT "isActive"')).toEqual([{n:1}])
            expect(await rows('SELECT count(*)::int AS n FROM units WHERE "displayName"=\'Local custom label\'')).toEqual([{n:1}])
            expect(await triggers()).toEqual([{n:schemaTriggers.length}])
            const failure=jest.spyOn(db,'sync').mockRejectedValueOnce(Error('Synthetic alter failure'))
            try{await expect(synchronizeDevelopment(db,'development')).rejects.toThrow('Synthetic alter failure')}
            finally{failure.mockRestore()}
            expect(await triggers()).toEqual([{n:schemaTriggers.length}])
            expect(await rows('SELECT * FROM users')).toEqual(before)
        } finally {
            if(previousUser===undefined)delete process.env.BOOTSTRAP_ADMIN_USERNAME;else process.env.BOOTSTRAP_ADMIN_USERNAME=previousUser
            if(previousPassword===undefined)delete process.env.BOOTSTRAP_ADMIN_PASSWORD;else process.env.BOOTSTRAP_ADMIN_PASSWORD=previousPassword
        }
    },60000)
})
