-- Additive, transactional migration. Apply before deploying the new backend.
-- Requires the existing customQuotes/productVariants/salespeople tables.
BEGIN;
SELECT pg_advisory_xact_lock(708202601);
ALTER TABLE "customQuotes" ADD COLUMN IF NOT EXISTS "configurationOrigin" VARCHAR(30) NOT NULL DEFAULT 'legacy_options';
ALTER TABLE "customQuotes" ADD COLUMN IF NOT EXISTS "snapshotVersion" SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE "customQuotes" ADD COLUMN IF NOT EXISTS "sourceProductVariantId" INTEGER;
ALTER TABLE "customQuotes" ADD COLUMN IF NOT EXISTS "confirmationKey" UUID;
ALTER TABLE "customQuotes" ADD COLUMN IF NOT EXISTS "confirmationRequestHash" VARCHAR(64);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customQuotes_source_variant_fk' AND conrelid = '"customQuotes"'::regclass) THEN
        ALTER TABLE "customQuotes" ADD CONSTRAINT "customQuotes_source_variant_fk" FOREIGN KEY ("sourceProductVariantId") REFERENCES "productVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "customQuotes_confirmation_unique" ON "customQuotes" ("salespersonId", "confirmationKey");
CREATE INDEX IF NOT EXISTS "customQuotes_source_variant_idx" ON "customQuotes" ("sourceProductVariantId");
COMMIT;
