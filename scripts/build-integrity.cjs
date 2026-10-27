const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const temporary = name => /(?:\.(?:tmp|temp|swp|swo|tsbuildinfo)|~)$/.test(name) || ['.cache', 'tmp', 'temp'].includes(name)
async function files(directory, suffixes, outputRoot) {
    const result = []
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name)
        if (temporary(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.')) continue
        if (outputRoot && filename === path.join(outputRoot, '.build-integrity')) continue
        if (entry.isSymbolicLink()) throw new Error('Symlink in build inputs or outputs')
        if (entry.isDirectory()) result.push(...await files(filename, suffixes, outputRoot))
        else if (entry.isFile() && (!suffixes || suffixes.some(suffix => entry.name.endsWith(suffix)))) result.push(filename)
    }
    return result
}
async function snapshot(base = root) {
    const inputs = (await files(path.join(base, 'src'), ['.ts', '.json'])).filter(name => !name.endsWith('.test.ts') && !name.includes(`${path.sep}test-utils${path.sep}`))
    const outputs = await files(path.join(base, 'dist'), null, path.join(base, 'dist'))
    if (!outputs.includes(path.join(base, 'dist', 'index.js'))) throw new Error('Missing build entrypoint')
    const relative = name => path.relative(base, name).split(path.sep).join('/')
    const administrative = []
    for (const name of ['scripts/build.cjs', 'scripts/database-input.cjs', 'scripts/schema-sync.cjs', 'scripts/release.cjs']) {
        const filename = path.join(base, name)
        try { await fs.access(filename); administrative.push(filename) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const names = [...inputs, ...outputs, ...administrative, ...['tsconfig.json', 'tsconfig.build.json', 'package.json', 'package-lock.json', 'scripts/build-integrity.cjs'].map(name => path.join(base, name))].sort((a, b) => relative(a) < relative(b) ? -1 : relative(a) > relative(b) ? 1 : 0)
    const hash = createHash('sha256')
    for (const name of names) {
        hash.update(JSON.stringify([relative(name), createHash('sha256').update(await fs.readFile(name)).digest('hex')]))
    }
    return hash.digest('hex')
}
async function run(mode, base = root) {
    if (!['stamp', 'verify'].includes(mode)) throw new Error('Invalid build integrity operation')
    const stamp = path.join(base, 'dist', '.build-integrity')
    const digest = await snapshot(base)
    if (mode === 'stamp') await fs.writeFile(stamp, digest)
    else if ((await fs.readFile(stamp, 'utf8')) !== digest) throw new Error('Stale build')
}
module.exports = { run }
if (require.main === module) run(process.argv[2]).catch(() => {
    console.error('Build missing, changed or stale. Run npm run build successfully before npm start. No backend was started.')
    process.exitCode = 1
})
