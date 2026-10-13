"use strict"
const fs = require("node:fs/promises")
const path = require("node:path")
const { randomUUID } = require("node:crypto")
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
    if (result.error || result.status !== 0) throw new Error("TypeScript compilation failed; previous dist retained")
}
async function run({ base = root, compiler = compile } = {}) {
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
    await compiler({ base: real, stage })
    await safeTree(stage)
    const entry = await fs.lstat(path.join(stage, "index.js"))
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Compiled build lacks a regular index.js; previous dist retained")
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
            await fs.rename(dist, backup)
            saved = true
        }
        if (await absentOrDirectory(dist)) throw new Error("Build destination changed during promotion")
        await fs.rename(stage, dist)
        promoted = true
        await integrity("stamp", real)
    } catch (error) {
        // Preserve failed output too; never delete files to restore the prior build.
        if (promoted) {
            await absentOrDirectory(dist)
            await safeTree(dist)
            if (await absentOrDirectory(stage)) throw new Error("Build failed and recovery staging path is occupied; artifacts retained")
            await fs.rename(dist, stage)
        }
        if (saved && !await absentOrDirectory(dist)) {
            await absentOrDirectory(backups)
            await absentOrDirectory(backup)
            await fs.rename(backup, dist)
        }
        throw error
    }
    return { dist, backup: saved ? backup : undefined }
}
module.exports = { run }
if (require.main === module) run().then(result => console.log(`Fresh build stamped. Previous output preserved${result.backup ? ` at ${result.backup}` : "; no previous dist"}.`)).catch(() => {
    console.error("Build failed; retained artifacts require inspection. No files were deleted.")
    process.exitCode = 1
})
