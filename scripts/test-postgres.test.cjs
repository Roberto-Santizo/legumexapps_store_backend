"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { argumentsOf, artifactDirectory, contained, safeEnvironment } = require("./test-postgres.cjs")

test("isolated runner accepts only explicit binaries and a new artifact directory, never URLs", () => {
    assert.deepEqual(argumentsOf(["--postgres-bin", "bin", "--artifacts", "output"]), { "--postgres-bin": "bin", "--artifacts": "output" })
    for (const args of [[], ["--artifacts", "output"], ["--postgres-bin", "bin", "--database-url", "postgres://remote/db"], ["--postgres-bin", "bin", "--artifacts", "out", "--artifacts", "second"]]) {
        assert.throws(() => argumentsOf(args))
    }
})

test("artifact validation rejects existing directories and both repository trees", () => {
    const backend = path.resolve(__dirname, "..")
    const frontend = path.resolve(backend, "../frontendLegumexStore")
    assert.throws(() => artifactDirectory(backend), /must not already exist/)
    assert.throws(() => artifactDirectory(path.join(backend, "never-create-test-postgres-artifacts")), /outside both/)
    assert.throws(() => artifactDirectory(path.join(frontend, "never-create-test-postgres-artifacts")), /outside both/)
    assert.equal(contained(path.join(backend, "scripts"), backend), true)
    assert.equal(contained(`${backend}-other`, backend), false)
})

test("subprocess environment discards inherited connection settings and secrets", () => {
    assert.deepEqual(safeEnvironment({ Path: "bin", SystemRoot: "Windows", TEMP: "tmp", PGHOST: "remote", PGSERVICEFILE: "private", DATABASE_URL: "secret", TEST_DATABASE_URL: "secret", JWT_SECRET: "secret", NODE_OPTIONS: "--require private", AWS_SECRET_ACCESS_KEY: "secret", RENDER_DATABASE_URL: "secret" }), {
        Path: "bin", SystemRoot: "Windows", TEMP: "tmp",
    })
})
