-- Additive migration: existing IDs, costs and association rows are untouched.
ALTER TABLE packagings ADD COLUMN classification VARCHAR(8) NOT NULL DEFAULT 'specific';
ALTER TABLE packagings ADD COLUMN "displayNameEn" VARCHAR(80) NULL;
ALTER TABLE packagings ADD CONSTRAINT packaging_classification_valid
    CHECK (classification IN ('specific', 'generic'));

-- SHARE conflicts with updates of the material, serializing assignment/reclassification.
-- Triggers change no association columns or existing rows, including legacy rows.
CREATE FUNCTION guard_packaging_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE material_classification TEXT; material_role TEXT;
BEGIN
    SELECT classification, "packagingRole" INTO material_classification, material_role
    FROM packagings WHERE id = NEW."packagingId" FOR SHARE;
    IF material_classification = 'generic' THEN
        RAISE EXCEPTION 'Generic packaging is not available for current configurations'
            USING ERRCODE = '23514', CONSTRAINT = 'packaging_generic_not_available';
    END IF;
    IF TG_ARGV[0] <> 'legacy' AND material_role <> TG_ARGV[0] THEN
        RAISE EXCEPTION 'Packaging role does not match association'
            USING ERRCODE = '23514', CONSTRAINT = 'packaging_role_mismatch';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER guard_unit_packaging BEFORE INSERT OR UPDATE OF "packagingId"
ON "productVariantUnitMaterials" FOR EACH ROW EXECUTE FUNCTION guard_packaging_assignment('unit');
CREATE TRIGGER guard_intermediate_packaging BEFORE INSERT OR UPDATE OF "packagingId"
ON "productVariantIntermediateMaterials" FOR EACH ROW EXECUTE FUNCTION guard_packaging_assignment('intermediate');
CREATE TRIGGER guard_pallet_packaging BEFORE INSERT OR UPDATE OF "packagingId"
ON "productVariantPalletMaterials" FOR EACH ROW EXECUTE FUNCTION guard_packaging_assignment('pallet');
CREATE TRIGGER guard_legacy_custom_packaging BEFORE INSERT OR UPDATE OF "packagingId"
ON "customQuotePackagingOptions" FOR EACH ROW EXECUTE FUNCTION guard_packaging_assignment('legacy');

CREATE FUNCTION guard_packaging_reclassification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.classification IS DISTINCT FROM OLD.classification
       OR NEW."packagingRole" IS DISTINCT FROM OLD."packagingRole" THEN
        IF EXISTS (SELECT 1 FROM "productVariantUnitMaterials" WHERE "packagingId" = OLD.id)
           OR EXISTS (SELECT 1 FROM "productVariantIntermediateMaterials" WHERE "packagingId" = OLD.id)
           OR EXISTS (SELECT 1 FROM "productVariantPalletMaterials" WHERE "packagingId" = OLD.id)
           OR EXISTS (SELECT 1 FROM "customQuotePackagingOptions" WHERE "packagingId" = OLD.id) THEN
            RAISE EXCEPTION 'Packaging has existing associations'
                USING ERRCODE = '23514', CONSTRAINT = 'packaging_associations_protected';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER guard_packaging_reclassification BEFORE UPDATE OF classification, "packagingRole"
ON packagings FOR EACH ROW EXECUTE FUNCTION guard_packaging_reclassification();
