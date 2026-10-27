"use strict"
const fs = require("node:fs/promises")
const path = require("node:path")
const { randomUUID, createHash } = require("node:crypto")
const { spawnSync } = require("node:child_process")
const { run: integrity } = require("./build-integrity.cjs")
const root = path.resolve(__dirname, "..")

async function absentOrDirectory(filename) {
    try {
        const stat = await fs.lstat(filename)
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Build path must be a real directory, never a symlink or junction")
        return true
    } catch (error) { if (error.code === "ENOENT") return false; throw error }
}
async function safeTree(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error("Symlink or junction in build tree")
        if (entry.isDirectory()) await safeTree(path.join(directory, entry.name))
    }
}
function compile({ base, stage }) {
    const result = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", path.join(base, "tsconfig.build.json"), "--outDir", stage], {
        cwd: base, stdio: "inherit", windowsHide: true,
    })
    if (result.error) throw Object.assign(new Error("TypeScript process could not start; previous dist retained"), { code: result.error.code })
    if (result.status !== 0) throw new Error("TypeScript compilation failed; previous dist retained")
}

async function manifest(directory) {
    const result = new Map()
    async function visit(current) {
        for (const entry of await fs.readdir(current, { withFileTypes: true })) {
            const filename = path.join(current, entry.name)
            if (entry.isSymbolicLink()) throw new Error("Symlink or junction in build tree")
            if (entry.isDirectory()) await visit(filename)
            else if (entry.isFile()) result.set(path.relative(directory, filename), createHash("sha256").update(await fs.readFile(filename)).digest("hex"))
            else throw new Error("Unsupported build artifact type")
        }
    }
    await visit(directory)
    return result
}
function sameManifest(actual, expected) {
    if (actual.size !== expected.size || [...expected].some(([name, hash]) => actual.get(name) !== hash)) throw new Error("Build files changed during promotion")
}
async function pruneCompilerBackups(base, keep = 1) {
    const rootDirectory = path.join(await fs.realpath(base), '.local-build-backups')
    if (!await absentOrDirectory(rootDirectory)) return
    const verified = []
    for (const entry of await fs.readdir(rootDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue
        const directory = path.join(rootDirectory, entry.name)
        try {
            if (await fs.realpath(directory) !== directory) continue
            await safeTree(directory)
            const inventory = JSON.parse(await fs.readFile(path.join(directory, '.compiler-output.json'), 'utf8'))
            if (inventory.producer !== 'legumex-typescript-build') continue
            const actual = await manifest(directory)
            actual.delete('.compiler-output.json'); actual.delete('.build-integrity')
            if ([...actual.keys()].some(name => !/\.(?:js|js\.map|d\.ts|d\.ts\.map|json)$/.test(name))) continue
            sameManifest(actual, new Map(Object.entries(inventory.files)))
            verified.push({ directory, modified: (await fs.stat(directory)).mtimeMs })
        } catch { /* Unknown, changed or recovery artifacts are preserved for manual review. */ }
    }
    verified.sort((a,b) => b.modified-a.modified)
    for (const {directory} of verified.slice(keep)) {
        if (path.dirname(directory)!==rootDirectory || await fs.realpath(directory)!==directory) throw new Error('Unsafe compiler backup cleanup path')
        await safeTree(directory)
        await fs.rm(directory, {recursive:true,force:false})
    }
}
async function parents(rootDirectory, filename) {
    const relative = path.relative(rootDirectory, path.dirname(filename))
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Build file escapes its tree")
    if (!await absentOrDirectory(rootDirectory)) throw new Error("Build tree disappeared")
    let current = rootDirectory
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment)
        if (!await absentOrDirectory(current)) await fs.mkdir(current)
    }
}
async function moveFile(fromRoot, toRoot, name, rename) {
    const from = path.join(fromRoot, name), to = path.join(toRoot, name)
    await parents(fromRoot, from)
    await parents(toRoot, to)
    const stat = await fs.lstat(from)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Build artifact must be a regular file")
    try { await fs.lstat(to); throw new Error("Build move would overwrite a retained artifact") }
    catch (error) { if (error.code !== "ENOENT") throw error }
    await rename(from, to)
}
async function moveFiles(from, to, expected, journal, rename) {
    // Invalidate the old build first; restore its seal last during rollback.
    const names = [...expected.keys()].sort((a, b) => a === ".build-integrity" ? -1 : b === ".build-integrity" ? 1 : a.localeCompare(b))
    for (const name of names) {
        await moveFile(from, to, name, rename)
        journal.push(name)
    }
}
async function restoreFiles(from, to, journal, rename) {
    for (const name of [...journal].reverse()) await moveFile(from, to, name, rename)
}

/** After a file-by-file promotion the staging tree only holds empty directories.
 * Remove them bottom-up with a non-recursive rmdir: a directory that still has any
 * entry (file, link or unexpected leftover) fails to delete and is kept.
 */
async function removeEmptyDirectories(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) await removeEmptyDirectories(path.join(directory, entry.name))
    }
    await fs.rmdir(directory).catch(error => { if (!["ENOTEMPTY", "EEXIST", "EPERM", "EBUSY"].includes(error.code)) throw error })
}

/** Windows can lock the directory entry while allowing its files to move.
 * Keep that directory, archive every old file, then promote the exact fresh tree.
 * No copy-over, deletion, stale output or valid seal during partial promotion.
 */
async function promoteFiles({ dist, stage, backup, real, fresh, rename, setPhase }) {
    const previous = await manifest(dist)
    const archived = [], promoted = []
    let sealing = false
    await fs.mkdir(backup)
    try {
        setPhase("archive-files")
        await moveFiles(dist, backup, previous, archived, rename)
        sameManifest(await manifest(backup), previous)
        sameManifest(await manifest(dist), new Map())
        setPhase("promote-files")
        await moveFiles(stage, dist, fresh, promoted, rename)
        sameManifest(await manifest(dist), fresh)
        setPhase("integrity")
        sealing = true
        await integrity("stamp", real)
        await integrity("verify", real)
    } catch (error) {
        try {
            // Retain any newly written seal, but never leave it on a partial build.
            const stamp = path.join(dist, ".build-integrity")
            if (sealing) {
                try {
                    await fs.lstat(stamp)
                    await moveFile(dist, stage, ".build-integrity", rename)
                } catch (stampError) { if (stampError.code !== "ENOENT") throw stampError }
            }
            await restoreFiles(dist, stage, promoted, rename)
            await restoreFiles(backup, dist, archived, rename)
            sameManifest(await manifest(dist), previous)
        } catch {
            error.recoveryFailed = true
        }
        throw error
    }
}

async function run({ base = root, compiler = compile, rename = fs.rename, platform = process.platform } = {}) {
    let phase = "validate"
    try {
    const resolved = path.resolve(base)
    const real = await fs.realpath(resolved)
    if (resolved !== real) throw new Error("Build repository path must be canonical")
    const id = randomUUID()
    const stage = path.join(real, `.build-stage-${id}`)
    const dist = path.join(real, "dist")
    const backups = path.join(real, ".local-build-backups")
    const backup = path.join(backups, id)
    const inside = filename => {
        const relative = path.relative(real, path.resolve(filename))
        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Build path escapes repository")
    }
    for (const filename of [stage, dist, backups, backup]) inside(filename)
    await absentOrDirectory(dist)
    await absentOrDirectory(backups)
    await fs.mkdir(stage)
    phase = "compile"
    await compiler({ base: real, stage })
    await safeTree(stage)
    const entry = await fs.lstat(path.join(stage, "index.js"))
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Compiled build lacks a regular index.js; previous dist retained")
    const generated = await manifest(stage)
    if (generated.has('.compiler-output.json')) throw new Error('Compiler output contains a reserved inventory')
    await fs.writeFile(path.join(stage,'.compiler-output.json'),JSON.stringify({producer:'legumex-typescript-build',files:Object.fromEntries(generated)}),{flag:'wx'})
    const fresh = await manifest(stage)
    if (fresh.has(".build-integrity")) throw new Error("Compiler output cannot contain a preexisting integrity seal")
    // Recheck destinations immediately before every rename, including Windows junctions.
    const hadDist = await absentOrDirectory(dist)
    if (hadDist) await safeTree(dist)
    if (!await absentOrDirectory(backups)) await fs.mkdir(backups)
    if (await absentOrDirectory(backup)) throw new Error("Build backup already exists")
    await absentOrDirectory(backups)
    let saved = false
    let promoted = false
    try {
        if (hadDist) {
            phase = "archive-directory"
            try { await rename(dist, backup) }
            catch (error) {
                if (platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error
                if (!await absentOrDirectory(dist) || await absentOrDirectory(backup)) throw error
                await promoteFiles({ dist, stage, backup, real, fresh, rename, setPhase: value => { phase = value } })
                await removeEmptyDirectories(stage).catch(() => console.warn('Build verified; empty staging directories retained.'))
                await pruneCompilerBackups(real).catch(() => console.warn('Build verified; unverified recovery artifacts retained.'))
                return { dist, backup, promotion: "files" }
            }
            saved = true
        }
        phase = "promote-directory"
        if (await absentOrDirectory(dist)) throw new Error("Build destination changed during promotion")
        await rename(stage, dist)
        promoted = true
        sameManifest(await manifest(dist), fresh)
        phase = "integrity"
        await integrity("stamp", real)
        await integrity("verify", real)
    } catch (error) {
        // Preserve failed output too; never delete files to restore the prior build.
        if (promoted) {
            await absentOrDirectory(dist)
            await safeTree(dist)
            if (await absentOrDirectory(stage)) throw new Error("Build failed and recovery staging path is occupied; artifacts retained")
            await rename(dist, stage)
        }
        if (saved && !await absentOrDirectory(dist)) {
            await absentOrDirectory(backups)
            await absentOrDirectory(backup)
            await rename(backup, dist)
        }
        throw error
    }
    await pruneCompilerBackups(real).catch(() => console.warn('Build verified; unverified recovery artifacts retained.'))
    return { dist, backup: saved ? backup : undefined, promotion: "directory" }
    } catch (error) {
        error.buildPhase = phase
        throw error
    }
}
function failureMessage(error) {
    const phases = ["validate", "compile", "archive-directory", "archive-files", "promote-files", "promote-directory", "integrity"]
    const phase = phases.includes(error.buildPhase) ? error.buildPhase : "unknown"
    const code = /^[A-Z0-9_]{1,30}$/.test(error.code ?? "") ? error.code : "validation"
    return `Build failed at ${phase} (${code}); artifacts retained, no files deleted.${error.recoveryFailed ? " Recovery incomplete: inspect retained trees before retrying." : ""}`
}
module.exports = { run, failureMessage, pruneCompilerBackups }
if (require.main === module) run().then(result => console.log(`Fresh build stamped and verified (${result.promotion} promotion). Previous output preserved${result.backup ? ` at ${result.backup}` : "; no previous dist"}.`)).catch(error => {
    console.error(failureMessage(error))
    process.exitCode = 1
})
