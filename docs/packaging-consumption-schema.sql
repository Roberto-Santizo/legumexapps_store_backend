-- PostgreSQL. Run before deploying the new backend. Preserves all existing rows.
BEGIN;
DO $$ BEGIN
    CREATE TYPE "enum_packagings_defaultQuantityBasis" AS ENUM ('per_box', 'per_pallet');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "packagings"
    ADD COLUMN IF NOT EXISTS "defaultQuantityBasis" "enum_packagings_defaultQuantityBasis",
    ADD COLUMN IF NOT EXISTS "defaultQuantityValue" NUMERIC(10, 2);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packagings_consumption_defaults_check' AND conrelid = '"packagings"'::regclass) THEN
        ALTER TABLE "packagings" ADD CONSTRAINT packagings_consumption_defaults_check CHECK (
            ("defaultQuantityBasis" IS NULL AND "defaultQuantityValue" IS NULL)
            OR ("packagingRole" = 'pallet' AND "defaultQuantityBasis" IS NOT NULL
                AND "defaultQuantityValue" IS NOT NULL AND "defaultQuantityValue" > 0
                AND "defaultQuantityValue" <= 99999999.99)
        );
    END IF;
END $$;
COMMIT;
-- No data defaults, synchronization triggers, table recreation, or snapshot changes.
