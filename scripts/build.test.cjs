"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { run } = require("./build.cjs")

async function fixture() {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "legumex-fresh-build-")))
    await fs.mkdir(path.join(base, "src"))
    await fs.mkdir(path.join(base, "scripts"))
    await fs.mkdir(path.join(base, "dist"))
    await fs.writeFile(path.join(base, "dist/index.js"), "old build")
    await fs.writeFile(path.join(base, "dist/obsolete.js"), "old obsolete file")
    for (const file of ["tsconfig.json", "tsconfig.build.json", "package.json", "package-lock.json", "scripts/build-integrity.cjs", "scripts/build.cjs"]) await fs.writeFile(path.join(base, file), "{}")
    return base
}
test("compilation failure preserves the previous dist and the partial staging output", async () => {
    const base = await fixture()
    await assert.rejects(run({ base, compiler: async ({ stage }) => {
        await fs.writeFile(path.join(stage, "partial.js"), "partial")
        throw new Error("synthetic compile failure")
    } }), /synthetic compile failure/)
    assert.equal(await fs.readFile(path.join(base, "dist/index.js"), "utf8"), "old build")
    assert.equal(await fs.readFile(path.join(base, "dist/obsolete.js"), "utf8"), "old obsolete file")
    const stage = (await fs.readdir(base)).find(name => name.startsWith(".build-stage-"))
    assert.equal(await fs.readFile(path.join(base, stage, "partial.js"), "utf8"), "partial")
})
test("successful compilation promotes only fresh output, stamps it and preserves old files in backup", async () => {
    const base = await fixture()
    const result = await run({ base, compiler: async ({ stage }) => fs.writeFile(path.join(stage, "index.js"), "fresh build") })
    assert.equal(await fs.readFile(path.join(result.dist, "index.js"), "utf8"), "fresh build")
    await assert.rejects(fs.access(path.join(result.dist, "obsolete.js")), { code: "ENOENT" })
    assert.equal(await fs.readFile(path.join(result.backup, "obsolete.js"), "utf8"), "old obsolete file")
    assert.equal(await fs.readFile(path.join(result.backup, "index.js"), "utf8"), "old build")
    assert.match(await fs.readFile(path.join(result.dist, ".build-integrity"), "utf8"), /^[a-f0-9]{64}$/)
})
test("non-directory destination is rejected before invoking compilation", async () => {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "legumex-build-path-")))
    await fs.writeFile(path.join(base, "dist"), "must not overwrite")
    let invoked = false
    await assert.rejects(run({ base, compiler: async () => { invoked = true } }), /real directory/)
    assert.equal(invoked, false)
    assert.equal(await fs.readFile(path.join(base, "dist"), "utf8"), "must not overwrite")
})
test("missing compiled entrypoint leaves the old build available", async () => {
    const base = await fixture()
    await assert.rejects(run({ base, compiler: async ({ stage }) => fs.writeFile(path.join(stage, "other.js"), "partial") }))
    assert.equal(await fs.readFile(path.join(base, "dist/index.js"), "utf8"), "old build")
})
test("junction or symlink destination is rejected without touching its target", async () => {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "legumex-build-link-")))
    const target = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "legumex-build-target-")))
    await fs.writeFile(path.join(target, "index.js"), "external build")
    await fs.symlink(target, path.join(base, "dist"), process.platform === "win32" ? "junction" : "dir")
    let invoked = false
    await assert.rejects(run({ base, compiler: async () => { invoked = true } }), /symlink or junction/)
    assert.equal(invoked, false)
    assert.equal(await fs.readFile(path.join(target, "index.js"), "utf8"), "external build")
})
test("stamp failure restores the previous dist and retains the unstamped fresh output", async () => {
    const base = await fixture()
    await fs.rename(path.join(base, "package.json"), path.join(base, "retained-package.json"))
    await assert.rejects(run({ base, compiler: async ({ stage }) => fs.writeFile(path.join(stage, "index.js"), "fresh but unstamped") }))
    assert.equal(await fs.readFile(path.join(base, "dist/index.js"), "utf8"), "old build")
    const stage = (await fs.readdir(base)).find(name => name.startsWith(".build-stage-"))
    assert.equal(await fs.readFile(path.join(base, stage, "index.js"), "utf8"), "fresh but unstamped")
})
