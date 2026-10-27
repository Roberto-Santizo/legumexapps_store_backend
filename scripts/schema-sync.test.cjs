const {test}=require('node:test')
const assert=require('node:assert/strict')
const {main,failureMessage}=require('./schema-sync.cjs')

test('environment aliases build current TypeScript before synchronizing without changing startup or bootstrap',()=>{
    const {scripts}=require('../package.json')
    assert.equal(scripts['db:dev'],'npm run build && node scripts/schema-sync.cjs development')
    assert.equal(scripts['db:prod'],'npm run build && node scripts/schema-sync.cjs production')
    assert.equal(scripts['db:bootstrap'],undefined)
    assert.equal(scripts.dev,'nodemon --watch src --exec ts-node src/index.ts')
    assert.equal(scripts.start,'node dist/index.js')
})

test('sync rejects invalid commands and unattended production before opening a connection',async()=>{
    for(const args of [[],['test'],['production','--yes'],['development','--force']])
        await assert.rejects(main(args,{}),/Use npm run/)
    const verifyBuild=async()=>undefined
    const env={PROD_DATABASE_URL:'postgres://owner:synthetic-secret@production.invalid:5432/app?sslmode=verify-full'}
    await assert.rejects(main(['production'],env,{verifyBuild,confirm:async()=> 'incorrect'}),/confirmation incorrect/)
    await assert.rejects(main(['development'],{DATABASE_URL:env.PROD_DATABASE_URL},{verifyBuild}),/Missing DEV_DATABASE_URL/)
    await assert.rejects(main(['development'],{DEV_DATABASE_URL:env.PROD_DATABASE_URL,PROD_DATABASE_URL:env.PROD_DATABASE_URL},{verifyBuild}),/different databases/)
})

test('sync blocks stale builds before resolving destinations and sanitizes PostgreSQL failures',async()=>{
    await assert.rejects(main(['development'],{},{verifyBuild:async()=>{throw Error('Stale build')}}),/Stale build/)
    const message=failureMessage({message:'postgres://secret:password@private/db',original:{code:'42501'}})
    assert.match(message,/42501/)
    assert.doesNotMatch(message,/secret|password|private/)
    assert.equal(failureMessage({name:'SchemaCompatibilityError',message:'Database schema incompatible: type mismatch users.name'}),'Database schema incompatible: type mismatch users.name')
})
