const {test}=require('node:test'),assert=require('node:assert/strict')
const {selection}=require('./database-input.cjs')
const parse=(value,environment,ca)=>({host:value,port:5432,database:'empty',username:'owner',environment,ca})

test('bootstrap CLI and interactive credential prompt are retired',()=>{
    assert.equal(require('../package.json').scripts['db:bootstrap'],undefined)
    assert.equal(require('node:fs').existsSync(require('node:path').join(__dirname,'bootstrap.cjs')),false)
    assert.equal(require('./database-input.cjs').credentialsPrompt,undefined)
})

test('prestart still verifies build without connecting or changing data',async()=>{
    const {main}=require('./release.cjs');let count=0
    await main({DATABASE_URL:'not a database URL'},{verifyBuild:async()=>{count++}})
    assert.equal(count,1)
})

test('initialization selects only the explicitly requested environment without fallback',()=>{
    assert.equal(selection(['--env','development'],{DEV_DATABASE_URL:'development',PROD_DATABASE_URL:'production'},parse).target.host,'development')
    assert.equal(selection(['--env','production'],{DEV_DATABASE_URL:'development',PROD_DATABASE_URL:'production'},parse).target.host,'production')
    assert.throws(()=>selection(['--env','development'],{DATABASE_URL:'must-not-be-used'},parse),/Missing DEV_DATABASE_URL/)
    assert.throws(()=>selection(['--env','production'],{DEV_DATABASE_URL:'other'},parse),/Missing PROD_DATABASE_URL/)
    assert.throws(()=>selection(['--env','development'],{DEV_DATABASE_URL:'same',PROD_DATABASE_URL:'same'},parse),/different databases/)
})

test('an optional CA for production is not applied to the unused local development URL',()=>{
    const {parseDatabaseConnection}=require('../dist/config/databaseConnection.js')
    const ca='-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----'
    const selected=selection(['--env','production'],{
        DEV_DATABASE_URL:'postgres://local:synthetic@127.0.0.1:5432/local',
        PROD_DATABASE_URL:'postgres://owner:synthetic@production.invalid:5432/empty?sslmode=verify-full',
        DATABASE_CA_CERT:ca,
    },parseDatabaseConnection)
    assert.deepEqual(selected.target.ssl,{rejectUnauthorized:true,ca})
})

