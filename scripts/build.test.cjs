"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { run, failureMessage } = require("./build.cjs")
const { run: integrity } = require("./build-integrity.cjs")

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

function lockedDirectory(base, extraFailure = () => false) {
    return async (from, to) => {
        if (from === path.join(base, "dist") || extraFailure(from, to)) throw Object.assign(new Error("synthetic Windows lock"), { code: "EPERM" })
        await fs.rename(from, to)
    }
}
async function freshCompiler({ stage }) {
    await fs.mkdir(path.join(stage, "nested"))
    await fs.writeFile(path.join(stage, "index.js"), "fresh build")
    await fs.writeFile(path.join(stage, "nested/current.js"), "fresh nested build")
}

test("Windows locked directory falls back to exact fresh files, preserves old output and verifies its seal", async () => {
    const base = await fixture()
    await fs.writeFile(path.join(base, "dist/.build-integrity"), "old seal")
    const result = await run({ base, platform: "win32", rename: lockedDirectory(base), compiler: freshCompiler })
    assert.equal(result.promotion, "files")
    assert.deepEqual((await fs.readdir(base)).filter(name => name.startsWith(".build-stage-")), [])
    assert.equal(await fs.readFile(path.join(result.backup, "obsolete.js"), "utf8"), "old obsolete file")
    assert.equal(await fs.readFile(path.join(result.backup, ".build-integrity"), "utf8"), "old seal")
    await assert.rejects(fs.access(path.join(result.dist, "obsolete.js")), { code: "ENOENT" })
    assert.equal(await fs.readFile(path.join(result.dist, "nested/current.js"), "utf8"), "fresh nested build")
    await integrity("verify", base)
    await fs.appendFile(path.join(result.dist, "index.js"), " tamper")
    await assert.rejects(integrity("verify", base), /Stale build/)
})

test("Windows archival failure restores old files and its seal last, without overwriting retained files", async () => {
    const base = await fixture()
    await fs.writeFile(path.join(base, "dist/.build-integrity"), "old seal")
    const rename = lockedDirectory(base, from => from === path.join(base, "dist/obsolete.js"))
    await assert.rejects(run({ base, platform: "win32", rename, compiler: freshCompiler }), { code: "EPERM" })
    assert.equal(await fs.readFile(path.join(base, "dist/index.js"), "utf8"), "old build")
    assert.equal(await fs.readFile(path.join(base, "dist/obsolete.js"), "utf8"), "old obsolete file")
    assert.equal(await fs.readFile(path.join(base, "dist/.build-integrity"), "utf8"), "old seal")
})

test("Windows promotion failure rolls back partial new output and restores all old files", async () => {
    const base = await fixture()
    await fs.writeFile(path.join(base, "dist/.build-integrity"), "old seal")
    const rename = lockedDirectory(base, (from, to) => from.includes(".build-stage-") && to === path.join(base, "dist/nested/current.js"))
    await assert.rejects(run({ base, platform: "win32", rename, compiler: freshCompiler }), { code: "EPERM" })
    assert.equal(await fs.readFile(path.join(base, "dist/index.js"), "utf8"), "old build")
    assert.equal(await fs.readFile(path.join(base, "dist/obsolete.js"), "utf8"), "old obsolete file")
    assert.equal(await fs.readFile(path.join(base, "dist/.build-integrity"), "utf8"), "old seal")
    const stage = (await fs.readdir(base)).find(name => name.startsWith(".build-stage-"))
    assert.equal(await fs.readFile(path.join(base, stage, "index.js"), "utf8"), "fresh build")
})

test("Windows stamp failure restores old output and retains fresh files without falsely sealing them", async () => {
    const base = await fixture()
    await fs.writeFile(path.join(base, "dist/.build-integrity"), "old seal")
    await fs.rename(path.join(base, "package.json"), path.join(base, "retained-package.json"))
    await assert.rejects(run({ base, platform: "win32", rename: lockedDirectory(base), compiler: freshCompiler }))
    assert.equal(await fs.readFile(path.join(base, "dist/index.js"), "utf8"), "old build")
    assert.equal(await fs.readFile(path.join(base, "dist/.build-integrity"), "utf8"), "old seal")
})

test("an injected stale file during Windows promotion is rejected, never included in a new valid seal", async () => {
    const base = await fixture()
    let injected = false
    const original = lockedDirectory(base)
    const rename = async (from, to) => {
        await original(from, to)
        if (!injected && from.includes(".build-stage-") && to.endsWith("index.js")) {
            injected = true
            await fs.writeFile(path.join(base, "dist/unexpected.js"), "unexpected file")
        }
    }
    await assert.rejects(run({ base, platform: "win32", rename, compiler: freshCompiler }), /files changed/)
    await assert.rejects(integrity("verify", base))
})

test("directory lock fallback is limited to Windows; diagnostics expose phase/code without raw error details", async () => {
    const base = await fixture()
    await assert.rejects(run({ base, platform: "linux", rename: lockedDirectory(base), compiler: freshCompiler }), { code: "EPERM", buildPhase: "archive-directory" })
    const message = failureMessage({ buildPhase: "archive-files", code: "EPERM", message: "password=must-not-be-printed" })
    assert.match(message, /archive-files \(EPERM\)/)
    assert.ok(!message.includes("password"))
})

test("failed rollback retains both builds and cannot leave a valid seal on partial Windows output", async () => {
    const base = await fixture()
    await fs.writeFile(path.join(base, "dist/.build-integrity"), "old seal")
    const rename = lockedDirectory(base, (from, to) =>
        (from.includes(".build-stage-") && to === path.join(base, "dist/nested/current.js"))
        || (from === path.join(base, "dist/index.js") && to.includes(".build-stage-")))
    await assert.rejects(run({ base, platform: "win32", rename, compiler: freshCompiler }), { recoveryFailed: true })
    await assert.rejects(integrity("verify", base))
    const backupName = (await fs.readdir(path.join(base, ".local-build-backups")))[0]
    assert.equal(await fs.readFile(path.join(base, ".local-build-backups", backupName, "index.js"), "utf8"), "old build")
    assert.equal(await fs.readFile(path.join(base, "dist/index.js"), "utf8"), "fresh build")
})
