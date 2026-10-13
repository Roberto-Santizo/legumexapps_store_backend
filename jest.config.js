/** @type {import('jest').Config} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    rootDir: "src",
    testMatch: ["**/*.test.ts"],
    setupFiles: ["reflect-metadata", "<rootDir>/shared/test-utils/environment.ts"],
    clearMocks: true,

    // Coverage
    collectCoverage: true,
    coverageReporters: ["lcov", "text"],
    coverageDirectory: "../coverage",
    collectCoverageFrom: [
        "**/*.ts",
        "!**/*.test.ts",
        "!index.ts",
    ],
}
