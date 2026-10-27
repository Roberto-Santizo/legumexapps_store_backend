// Focused fixture for trigger concurrency tests; full schema creation is verified separately.
export async function createPackagingDatabase(database: { query: (sql: string) => Promise<unknown> }) {
    await database.query(`CREATE TABLE packagings (
        id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, "displayName" TEXT NOT NULL,
        classification TEXT NOT NULL DEFAULT 'specific' CHECK (classification IN ('specific','generic')), "displayNameEn" TEXT,
        "packagingRole" TEXT NOT NULL, "unitCost" NUMERIC(10,4), "isActive" BOOLEAN NOT NULL DEFAULT true
    )`)
    for (const table of ["productVariantUnitMaterials", "productVariantIntermediateMaterials", "productVariantPalletMaterials"]) {
        await database.query(`CREATE TABLE "${table}" (
            id SERIAL PRIMARY KEY, "packagingId" INTEGER NOT NULL REFERENCES packagings(id),
            "isActive" BOOLEAN NOT NULL DEFAULT true
        )`)
    }
}
