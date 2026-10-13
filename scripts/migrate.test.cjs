const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { run, readPlan, parseDestination, approvalDigest, ValidationError, safeError } = require('./migrate.cjs')
const local = 'postgres://tester:synthetic@127.0.0.1:5432/isolated'
const prod = 'postgres://produser:synthetic@production.invalid:5432/live?sslmode=verify-full'
const now = Date.parse('2026-10-12T12:00:00Z'), expires = '2026-10-12T12:30:00Z'
function setup(url = local, environment = 'development') {
 const target = parseDestination(url), prefix = { development:'DEV', test:'TEST', production:'PROD' }[environment]
 const env = { [`${prefix}_DATABASE_URL`]:url, [`${prefix}_MIGRATION_TARGET_SHA256`]:target.fingerprint }
 const policy = { productionDatabases:[parseDestination(prod).databaseFingerprint], targets:[{ environment, fingerprint:target.fingerprint, databaseFingerprint:target.databaseFingerprint, isolatedCredentialsVerified:true }] }
 if (environment === 'production') policy.productionDatabases = [target.databaseFingerprint]
 const calls = { create:0, connect:0, end:0, queries:[], logs:[] }, client = new EventEmitter()
 client.connect = async () => { calls.connect++ }
 client.end = async () => { calls.end++ }
 client.query = async sql => { calls.queries.push(sql); return { rowCount:0, rows:[] } }
 const deps = { now:()=>now, targetPolicy:policy, log:value=>calls.logs.push(value), createClient:config=>{ calls.create++; calls.config=config; return client } }
 return { env, policy, calls, client, deps }
}
async function rejected(s, args=['--env','development']) {
 await assert.rejects(run(args,s.env,s.deps),ValidationError)
 assert.equal(s.calls.create,0); assert.equal(s.calls.connect,0); assert.deepEqual(s.calls.queries,[])
}
test('explicit environment and no legacy or cross-environment fallback',async()=>{
 await rejected(setup(),[])
 const s=setup(); s.env={ NODE_ENV:'development', DATABASE_URL:local, PROD_DATABASE_URL:prod }; await rejected(s)
 await rejected(setup(),['--env','staging']); await rejected(setup(),['--env','development','--force'])
 await rejected(setup(),['--env','test'])
})
test('environment pins alone cannot authorize; reviewed registry required',async()=>{
 for(const policy of [{ productionDatabases:[],targets:[] },{ productionDatabases:[parseDestination(prod).databaseFingerprint],targets:[] }]) {
 const s=setup(); s.deps.targetPolicy=policy; await rejected(s)
 }
})
test('A1 production relabeling and changing role cannot bypass production inventory',async()=>{
 for(const environment of ['development','test']) for(const url of [prod,prod.replace('produser','otherrole')]) await rejected(setup(url,environment),['--env',environment])
})
test('available production URL identifiers and pins detect contradictions',async()=>{
 for(const key of ['PROD_DATABASE_URL','DATABASE_URL']) { const s=setup(); s.env[key]=local.replace('tester','productionrole'); await rejected(s) }
 const s=setup(); s.env.PROD_MIGRATION_TARGET_SHA256=parseDestination(local).fingerprint; await rejected(s)
 const bad=setup(); bad.env.PROD_DATABASE_URL='invalid-secret'; await rejected(bad)
})
for(const key of ['PGHOST','PGPORT','PGOPTIONS','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSERVICE','PGAPPNAME','PGROLE','PGSEARCHPATH','PGANYTHING']) test(`A2 ${key} rejected before client creation`,async()=>{
 const s=setup(); s.env[key]='-c role=production -c search_path=private'; await rejected(s)
})
test('ambient PGOPTIONS rejected',async()=>{
 const previous=process.env.PGOPTIONS
 try { process.env.PGOPTIONS='-c role=production'; await rejected(setup()) }
 finally { if(previous===undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS=previous }
})
test('explicit ports, valid encoding and no schema/role URL overrides',async()=>{
 for(const url of [local.replace(':5432',''),local+'?options=role',local+'?search_path=private',local+'?role=admin',local.replace('tester','%ZZ')]) {
 const s=setup(); s.env.DEV_DATABASE_URL=url; await rejected(s)
 }
})
test('localhost and alternate tunnel ports need independently registered authorization',async()=>{
 const missing=setup(); delete missing.env.DEV_MIGRATION_TARGET_SHA256; await rejected(missing)
 for(const url of [local.replace(':5432',':6543'),local.replace('127.0.0.1','localhost')]) {
 const s=setup(); s.env.DEV_DATABASE_URL=url; await rejected(s)
 s.env.DEV_MIGRATION_TARGET_SHA256=parseDestination(url).fingerprint; await rejected(s)
 }
})
test('effective pg parameters verified by constructor only, no real connection',async()=>{
 for(const url of [local,'postgres://tester:synthetic@dev.invalid:6543/isolated?sslmode=verify-full']) {
 const s=setup(url); await run(['--env','development'],s.env,s.deps)
 const pg=new (require('pg').Client)(s.calls.config)
 for(const key of ['host','port','database','user','password','options']) assert.equal(pg.connectionParameters[key],s.calls.config[key])
 assert.equal(pg.connectionParameters.options,'-c search_path=public')
 assert.equal(s.calls.config.connectionString,undefined)
 assert.deepEqual(pg.connectionParameters.ssl,url===local?false:{rejectUnauthorized:true})
 assert.equal(s.calls.end,1)
 }
})
test('offline plan needs no secrets or registry, never constructs a client',async()=>{
 const s=setup(); s.env={ PGOPTIONS:'anything' }; await run(['--env','test','--plan'],s.env,s.deps)
 assert.equal(s.calls.create,0); assert.ok(s.calls.logs.some(line=>line.includes('cannot be determined')))
})
test('synthetic production confirmation binds target manifest and expiry',async()=>{
 const s=setup(prod,'production'),plan=await readPlan(),digest=approvalDigest(parseDestination(prod).fingerprint,plan,expires)
 await run(['--env','production','--expires',expires,'--approval',digest],s.env,s.deps)
 assert.equal(s.calls.connect,1)
 for(const [expiry,token] of [[expires,'true'],['2026-10-12T11:00:00Z',digest],['2026-10-12T14:00:00Z',digest],['2026-10-12T12:31:00Z',digest],[expires,approvalDigest('wrong',plan,expires)],[expires,approvalDigest(parseDestination(prod).fingerprint,[],expires)]]) await rejected(setup(prod,'production'),['--env','production','--expires',expiry,'--approval',token])
})

test('production loopback cannot disable TLS despite target registration',async()=>{
 await rejected(setup(local,'production'),['--env','production','--expires',expires,'--approval','not-an-approval'])
})

test('rebuild has a separate artifact-bound confirmation; migration/bootstrap tokens cannot authorize deletion',async()=>{
 const artifact='c'.repeat(64),plan=await readPlan(),fingerprint=parseDestination(prod).fingerprint
 for(const operation of ['migration','bootstrap']) {
  const s=setup(prod,'production');s.deps.administrativeOperation={name:'rebuild',artifact,execute:async()=>assert.fail('Must not execute')}
  await rejected(s,['--env','production','--expires',expires,'--approval',approvalDigest(fingerprint,plan,expires,operation,artifact)])
 }
 const s=setup(prod,'production');let executed=0;s.deps.administrativeOperation={name:'rebuild',artifact,execute:async()=>{executed++}}
 await run(['--env','production','--expires',expires,'--approval',approvalDigest(fingerprint,plan,expires,'rebuild',artifact)],s.env,s.deps)
 assert.equal(executed,1)
})

test('administrative clients retain verified TLS with the approved PEM CA',async()=>{
 const s=setup(prod,'production'),plan=await readPlan();s.env.DATABASE_CA_CERT='-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----'
 await run(['--env','production','--expires',expires,'--approval',approvalDigest(parseDestination(prod).fingerprint,plan,expires)],s.env,s.deps)
 assert.deepEqual(s.calls.config.ssl,{rejectUnauthorized:true,ca:s.env.DATABASE_CA_CERT})
 const bad=setup();bad.env.DATABASE_CA_CERT=s.env.DATABASE_CA_CERT;await rejected(bad)
})

test('bootstrap inherits destination controls and its own artifact-bound confirmation',async()=>{
 const artifact='a'.repeat(64), plan=await readPlan()
 let executed=0
 const operation={name:'bootstrap',artifact,execute:async()=>{executed++}}
 const blocked=setup(prod,'production'); blocked.deps.administrativeOperation=operation
 await rejected(blocked,['--env','production','--expires',expires,'--approval',approvalDigest(parseDestination(prod).fingerprint,plan,expires)])
 const changed=setup(prod,'production'); changed.deps.administrativeOperation=operation
 await rejected(changed,['--env','production','--expires',expires,'--approval',approvalDigest(parseDestination(prod).fingerprint,plan,expires,'bootstrap','b'.repeat(64))])
 const approved=setup(prod,'production'); approved.deps.administrativeOperation=operation
 await run(['--env','production','--expires',expires,'--approval',approvalDigest(parseDestination(prod).fingerprint,plan,expires,'bootstrap',artifact)],approved.env,approved.deps)
 assert.equal(executed,1); assert.deepEqual(approved.calls.queries,[])
 const empty=setup(); empty.deps.administrativeOperation=operation; empty.deps.targetPolicy={productionDatabases:[],targets:[]}
 await rejected(empty); assert.equal(executed,1)
})
async function fixture(t, files) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'legumex-migration-test-'))
 const absolute=path.resolve(dir), root=path.resolve(os.tmpdir())
 if(path.dirname(absolute)!==root || !path.basename(absolute).startsWith('legumex-migration-test-')) throw new Error('Unsafe temporary fixture path')
 // Only this test's mkdtemp result is eligible for removal, never a glob or older runs.
 t.after(()=>fs.rm(absolute,{recursive:true,force:true}))
 for(const [name,sql] of Object.entries(files)) await fs.writeFile(path.join(dir,name),sql)
 return dir
}
test('invalid SQL names, case, duplicate versions and empty manifest fail disconnected',async t=>{
 for(const files of [{'bad.sql':'SELECT 1'},{'202610120001_bad.SQL':'SELECT 1'},{'202610120001_a.sql':'','202610120001_b.sql':''},{}]) {
 const s=setup(); s.deps.migrationsDirectory=await fixture(t,files); await rejected(s)
 }
})
test('sorted versions and changed SQL checksums',async t=>{
 const dir=await fixture(t,{'202610120002_b.sql':'SELECT 2','202610120001_a.sql':'SELECT 1\r\n'}),plan=await readPlan(dir)
 assert.deepEqual(plan.map(row=>row.version),['202610120001_a.sql','202610120002_b.sql'])
 await fs.writeFile(path.join(dir,plan[0].version),'SELECT 3'); assert.notEqual((await readPlan(dir))[0].checksum,plan[0].checksum)
})
test('checksum mismatch and non-prefix history release lock without running migration SQL',async()=>{
 const plan=await readPlan()
 for(const rows of [[{version:plan[0].version,checksum:'changed'}],[{version:plan[1].version,checksum:plan[1].checksum}],[{version:'unknown.sql',checksum:'x'}]]) {
 const s=setup(),query=s.client.query
 s.client.query=async sql=>{const result=await query(sql);return sql.startsWith('SELECT version,')?{rows}:result}
 await assert.rejects(run(['--env','development'],s.env,s.deps),ValidationError)
 assert.ok(s.calls.queries.at(-1).includes('pg_advisory_unlock')); assert.ok(!s.calls.queries.includes('BEGIN')); assert.equal(s.calls.end,1)
 }
})
test('SQL failure rolls back releases lock closes client and suppresses driver payload',async()=>{
 const s=setup(),query=s.client.query,plan=await readPlan()
 s.client.query=async sql=>{await query(sql);if(sql===plan[0].sql)throw new Error('postgres://sensitive');return {rows:[],rowCount:0}}
 await assert.rejects(run(['--env','development'],s.env,s.deps),error=>!error.message.includes('postgres://'))
 assert.ok(s.calls.queries.includes('ROLLBACK'));assert.ok(s.calls.queries.at(-1).includes('pg_advisory_unlock'));assert.equal(s.calls.end,1)
})
test('client error events handled and connect failure closes client without secret logs',async()=>{
 const s=setup();s.client.connect=async()=>{s.calls.connect++;s.client.emit('error',new Error('sensitive'));throw new Error('sensitive')}
 await assert.rejects(run(['--env','development'],s.env,s.deps),/sensitive details suppressed/)
 assert.equal(s.calls.end,1);assert.doesNotThrow(()=>s.client.emit('error',new Error('late sensitive event')));assert.deepEqual(s.calls.logs,[])
 assert.equal(safeError(new ValidationError('Safe validation')),'Safe validation');assert.ok(!safeError(new Error('postgres://sensitive')).includes('postgres://'))
})
test('development/test plans reject meaningless expiry without connecting',async()=>{
 for(const environment of ['development','test']) await rejected(setup(),['--env',environment,'--plan','--expires',expires])
})
test('validation remains primary when unlock and close both fail',async()=>{
 const s=setup(),query=s.client.query,plan=await readPlan()
 s.client.query=async sql=>{
  await query(sql)
  if(sql.includes('pg_advisory_unlock')) throw new Error('secret unlock')
  return sql.startsWith('SELECT version,')?{rows:[{version:plan[0].version,checksum:'bad'}]}:{rows:[],rowCount:0}
 }
 s.client.end=async()=>{s.calls.end++;throw new Error('secret close')}
 await assert.rejects(run(['--env','development'],s.env,s.deps),error=>{
  assert.ok(error instanceof ValidationError)
  assert.match(error.message,/^Applied migration checksum mismatch$/i)
  assert.deepEqual(error.cleanupFailures,['advisory unlock','client close'])
  assert.ok(!safeError(error).includes('secret'))
  assert.match(safeError(error),/cleanup failed: advisory unlock, client close/)
  return true
 })
 assert.equal(s.calls.end,1)
 assert.deepEqual(s.calls.logs,[])
})
test('cleanup-only failure is reported safely without success log',async()=>{
 const s=setup();s.client.end=async()=>{throw new Error('postgres://secret')}
 await assert.rejects(run(['--env','development'],s.env,s.deps),error=>{
  assert.deepEqual(error.cleanupFailures,['client close'])
  assert.ok(!safeError(error).includes('postgres://'))
  return true
 })
 assert.deepEqual(s.calls.logs,[])
})
test('rollback failure still attempts unlock and preserves safe cleanup evidence',async()=>{
 const s=setup(),query=s.client.query,plan=await readPlan()
 s.client.query=async sql=>{
  const result=await query(sql)
  if(sql===plan[0].sql || sql==='ROLLBACK') throw new Error('secret driver failure')
  return result
 }
 await assert.rejects(run(['--env','development'],s.env,s.deps),error=>{
  assert.deepEqual(error.cleanupFailures,['rollback'])
  assert.ok(!safeError(error).includes('secret driver'))
  return true
 })
 assert.ok(s.calls.queries.at(-1).includes('pg_advisory_unlock'))
 assert.equal(s.calls.end,1)
})
