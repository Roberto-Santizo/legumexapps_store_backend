const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { deploy, identity, readPlan, parseDestination, ValidationError, DEPLOY_REQUIRED_HISTORY } = require('./migrate.cjs')
const { main: release } = require('./release.cjs')

const prod = 'postgres://produser:synthetic@production.invalid:5432/live?sslmode=verify-full'
const dev = 'postgres://devuser:synthetic@dev.invalid:5432/devdb?sslmode=verify-full'

// Synthetic client: answers the ledger queries with `history`; records every statement.
function setup({ url = prod, environment = 'production', history } = {}) {
 const target = parseDestination(url)
 const policy = { productionDatabases: [parseDestination(prod).databaseFingerprint],
  targets: [{ environment, fingerprint: target.fingerprint, databaseFingerprint: target.databaseFingerprint, isolatedCredentialsVerified: true }] }
 const calls = { create: 0, connect: 0, end: 0, queries: [], logs: [], after: 0 }, client = new EventEmitter()
 client.connect = async () => { calls.connect++ }
 client.end = async () => { calls.end++ }
 client.query = async sql => {
  calls.queries.push(sql)
  if (sql.startsWith('SELECT version,')) return { rows: history ?? [] }
  if (sql.includes('to_regclass')) return { rows: [{ name: history ? 'schema_migrations' : null }] }
  return { rows: [], rowCount: 0 }
 }
 const env = { NODE_ENV: environment, DATABASE_URL: url }
 const deps = { targetPolicy: policy, log: value => calls.logs.push(value), createClient: config => { calls.create++; calls.config = config; return client },
  afterMigrate: async () => { calls.after++; calls.queries.push('AFTER_MIGRATE') } }
 return { env, calls, deps }
}
async function recorded(versions) {
 const plan = await readPlan()
 return versions.map(version => ({ version, checksum: plan.find(item => item.version === version).checksum }))
}
async function refusedBeforeConnecting(s) {
 await assert.rejects(deploy(s.env, s.deps), ValidationError)
 assert.equal(s.calls.create, 0); assert.deepEqual(s.calls.queries, [])
}

const PENDING = ['202610140001_remove_raw_material_mixability.sql', '202610140002_remove_product_recipe_type.sql']

test('production applies only the pending incremental migrations without an approval token, then syncs reference data', async () => {
 const plan = await readPlan(), s = setup({ history: await recorded(DEPLOY_REQUIRED_HISTORY) })
 const applied = await deploy(s.env, s.deps)
 assert.deepEqual(applied, PENDING)
 for (const version of applied) assert.equal(s.calls.queries.filter(sql => sql === plan.find(item => item.version === version).sql).length, 1)
 assert.equal(s.calls.queries.filter(sql => sql === 'BEGIN').length, PENDING.length)
 assert.ok(s.calls.queries.some(sql => sql.startsWith('INSERT INTO schema_migrations')))
 // Reference data runs after the migration transaction committed and the lock was released.
 const order = name => s.calls.queries.findIndex(sql => sql.includes(name))
 assert.ok(order('COMMIT') < order('pg_advisory_unlock') && order('pg_advisory_unlock') < order('AFTER_MIGRATE'))
 assert.equal(s.calls.after, 1); assert.equal(s.calls.end, 1)
 assert.deepEqual(s.calls.config.ssl, { rejectUnauthorized: true })
})

test('a database that already recorded the isMixable removal applies only the recipe-type removal', async () => {
 const s = setup({ history: await recorded([...DEPLOY_REQUIRED_HISTORY, PENDING[0]]) })
 assert.deepEqual(await deploy(s.env, s.deps), [PENDING[1]])
 assert.ok(!s.calls.queries.some(sql => sql.includes('isMixable')))
 assert.ok(s.calls.queries.some(sql => sql.includes('"isCustomizable"')))
})

test('an up-to-date database applies nothing and still syncs reference data', async () => {
 const s = setup({ history: await recorded((await readPlan()).map(item => item.version)) })
 assert.deepEqual(await deploy(s.env, s.deps), [])
 assert.ok(!s.calls.queries.includes('BEGIN')); assert.equal(s.calls.after, 1)
})

test('refuses a new/empty database or a history missing the reviewed historical migrations', async () => {
 for (const history of [[], await recorded(['202610110001_initial_schema.sql'])]) {
  const s = setup({ history })
  await assert.rejects(deploy(s.env, s.deps), /reviewed historical migrations/)
  assert.ok(!s.calls.queries.includes('BEGIN')); assert.equal(s.calls.after, 0)
  assert.ok(s.calls.queries.at(-1).includes('pg_advisory_unlock')); assert.equal(s.calls.end, 1)
 }
})

test('checksum mismatch or unknown history versions stop before any migration', async () => {
 const good = await recorded(DEPLOY_REQUIRED_HISTORY)
 for (const history of [[{ ...good[0], checksum: 'changed' }, ...good.slice(1)], [...good, { version: '209912310001_unknown.sql', checksum: 'x' }]]) {
  const s = setup({ history })
  await assert.rejects(deploy(s.env, s.deps), ValidationError)
  assert.ok(!s.calls.queries.includes('BEGIN')); assert.equal(s.calls.after, 0)
 }
})

test('refuses mass deletion statements in a pending migration', async t => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'legumex-deploy-test-'))
 if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe temporary fixture path')
 t.after(() => fs.rm(dir, { recursive: true, force: true }))
 const plan = await readPlan()
 for (const item of plan.filter(row => DEPLOY_REQUIRED_HISTORY.includes(row.version))) await fs.writeFile(path.join(dir, item.version), item.sql)
 for (const sql of ['DROP TABLE public."quotes";', 'DROP SCHEMA public CASCADE;', 'TRUNCATE public."quotes";', 'DELETE FROM public."quotes";', 'DROP OWNED BY someone;']) {
  await fs.writeFile(path.join(dir, '209912310001_destructive.sql'), sql)
  const s = setup({ history: await recorded(DEPLOY_REQUIRED_HISTORY) }); s.deps.migrationsDirectory = dir
  await assert.rejects(deploy(s.env, s.deps), /mass deletion/)
  assert.ok(!s.calls.queries.includes('BEGIN')); assert.equal(s.calls.after, 0)
 }
})

test('a failed migration rolls back, skips reference data and fails the release', async () => {
 const s = setup({ history: await recorded(DEPLOY_REQUIRED_HISTORY) }), query = s.deps.createClient
 s.deps.createClient = config => { const client = query(config), original = client.query
  client.query = async sql => { const result = await original(sql); if (sql.includes('isMixable')) throw new Error('postgres://secret'); return result }
  return client }
 await assert.rejects(deploy(s.env, s.deps), error => !error.message.includes('postgres://'))
 assert.ok(s.calls.queries.includes('ROLLBACK')); assert.equal(s.calls.after, 0); assert.equal(s.calls.end, 1)
})

test('destination controls run before connecting: registry, environment, TLS, PG* and production isolation', async () => {
 await refusedBeforeConnecting(Object.assign(setup(), { env: { DATABASE_URL: prod } }))
 await refusedBeforeConnecting(Object.assign(setup(), { env: { NODE_ENV: 'production' } }))
 const unregistered = setup(); unregistered.deps.targetPolicy = { ...unregistered.deps.targetPolicy, targets: [] }; await refusedBeforeConnecting(unregistered)
 const wrongEnvironment = setup(); wrongEnvironment.env.NODE_ENV = 'development'; await refusedBeforeConnecting(wrongEnvironment)
 const noTls = setup(); noTls.env.DATABASE_URL = prod.replace('?sslmode=verify-full', ''); await refusedBeforeConnecting(noTls)
 await refusedBeforeConnecting(setup({ url: 'postgres://produser:synthetic@127.0.0.1:5432/live?sslmode=disable' }))
 await refusedBeforeConnecting(setup({ url: prod.replace('produser', 'otherrole'), environment: 'development' }))
 const pg = setup(); pg.env.PGOPTIONS = '-c role=other'; await refusedBeforeConnecting(pg)
 const ambient = process.env.PGHOST
 try { process.env.PGHOST = 'elsewhere'; await refusedBeforeConnecting(setup()) } finally { if (ambient === undefined) delete process.env.PGHOST; else process.env.PGHOST = ambient }
})

test('development uses its own registered database the same way', async () => {
 const s = setup({ url: dev, environment: 'development', history: await recorded(DEPLOY_REQUIRED_HISTORY) })
 assert.deepEqual(await deploy(s.env, s.deps), PENDING)
})

test('deploy-check is read-only: no ledger creation, no migration, no reference data', async () => {
 const s = setup({ history: await recorded(DEPLOY_REQUIRED_HISTORY) })
 assert.deepEqual(await deploy(s.env, { ...s.deps, dryRun: true }), PENDING)
 assert.equal(s.calls.queries[0], 'SET default_transaction_read_only = on')
 assert.ok(!s.calls.queries.some(sql => /CREATE TABLE|BEGIN|INSERT|isMixable|isCustomizable/.test(sql)))
 assert.equal(s.calls.after, 0)
 const empty = setup()
 await assert.rejects(deploy(empty.env, { ...empty.deps, dryRun: true }), /no migration history/)
 assert.ok(!empty.calls.queries.some(sql => /CREATE TABLE/.test(sql)))
})

test('identity prints registry fingerprints offline and never the password', () => {
 const result = identity({ DATABASE_URL: prod })
 assert.equal(result.fingerprint, parseDestination(prod).fingerprint)
 assert.equal(result.tls, true)
 assert.ok(!JSON.stringify(result).includes('synthetic'))
})

test('release verifies the build first, then deploys with reference data sync', async () => {
 const s = setup({ history: await recorded(DEPLOY_REQUIRED_HISTORY) })
 let synced = 0
 await release(s.env, { ...s.deps, verifyBuild: async () => {}, loadSync: () => async () => { synced++ } })
 assert.equal(synced, 1)
 const stale = setup({ history: await recorded(DEPLOY_REQUIRED_HISTORY) })
 await assert.rejects(release(stale.env, { ...stale.deps, verifyBuild: async () => { throw new Error('Stale build') }, loadSync: () => assert.fail('must not load') }), /Build missing, changed or stale/)
 assert.equal(stale.calls.create, 0)
})
