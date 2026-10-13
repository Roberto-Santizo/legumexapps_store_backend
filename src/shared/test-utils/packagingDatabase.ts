// Minimal pre-migration schema for isolated PostgreSQL migration tests only.
export async function createPackagingDatabase(database: { query: (sql: string) => Promise<unknown> }) {
    await database.query(`CREATE TABLE packagings (
        id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, "displayName" TEXT NOT NULL,
        "packagingRole" TEXT NOT NULL, "unitCost" NUMERIC(10,4), "isActive" BOOLEAN NOT NULL DEFAULT true
    )`)
    for (const table of ["productVariantUnitMaterials", "productVariantIntermediateMaterials", "productVariantPalletMaterials", "customQuotePackagingOptions"]) {
        await database.query(`CREATE TABLE "${table}" (
            id SERIAL PRIMARY KEY, "packagingId" INTEGER NOT NULL REFERENCES packagings(id),
            "isActive" BOOLEAN NOT NULL DEFAULT true
        )`)
    }
}
