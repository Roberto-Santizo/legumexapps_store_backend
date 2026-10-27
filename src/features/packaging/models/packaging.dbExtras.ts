// Complementos PostgreSQL (CHECK / funciones / triggers) de packaging. Clasificación/rol de empaques y protección de sus asociaciones.
// Los agrega database/schemaExtras.ts; tablas, columnas, claves e índices viven en los modelos.
export const packagingChecks = [
    {
        "table": "packagings",
        "name": "packagings_consumption_defaults_check",
        "expression": "(\"defaultQuantityBasis\" IS NULL AND \"defaultQuantityValue\" IS NULL) OR (\"packagingRole\"='pallet' AND \"defaultQuantityBasis\" IS NOT NULL AND \"defaultQuantityValue\" IS NOT NULL AND \"defaultQuantityValue\">0 AND \"defaultQuantityValue\"<=99999999.99)"
    },
    {
        "table": "packagings",
        "name": "packaging_classification_valid",
        "expression": "classification IN ('specific','generic')"
    },
    {
        "table": "packagings",
        "name": "packagings_material_type_check",
        "expression": "(\"packagingRole\"='unit' AND \"materialType\"='INDIVIDUAL') OR (\"packagingRole\"='intermediate' AND \"materialType\"='INTERMEDIO') OR (\"packagingRole\"='pallet' AND \"materialType\" IN ('CAJA','TARIMA','ESQUINERO','STRETCH','OTRO'))"
    }
] as const;
export const packagingFunctions = [
    {
        "name": "guard_packaging_assignment",
        "body": "\nDECLARE material_classification TEXT; material_role TEXT;\nBEGIN\n    SELECT classification, \"packagingRole\" INTO material_classification, material_role\n    FROM packagings WHERE id = NEW.\"packagingId\" FOR SHARE;\n    IF material_classification = 'generic' THEN\n        RAISE EXCEPTION 'Generic packaging is not available for current configurations'\n            USING ERRCODE = '23514', CONSTRAINT = 'packaging_generic_not_available';\n    END IF;\n    IF material_role <> TG_ARGV[0] THEN\n        RAISE EXCEPTION 'Packaging role does not match association'\n            USING ERRCODE = '23514', CONSTRAINT = 'packaging_role_mismatch';\n    END IF;\n    RETURN NEW;\nEND "
    },
    {
        "name": "guard_packaging_reclassification",
        "body": "\nBEGIN\n    IF NEW.classification IS DISTINCT FROM OLD.classification\n       OR NEW.\"packagingRole\" IS DISTINCT FROM OLD.\"packagingRole\" THEN\n        IF EXISTS (SELECT 1 FROM \"productVariantUnitMaterials\" WHERE \"packagingId\" = OLD.id)\n           OR EXISTS (SELECT 1 FROM \"productVariantIntermediateMaterials\" WHERE \"packagingId\" = OLD.id)\n           OR EXISTS (SELECT 1 FROM \"productVariantPalletMaterials\" WHERE \"packagingId\" = OLD.id) THEN\n            RAISE EXCEPTION 'Packaging has existing associations'\n                USING ERRCODE = '23514', CONSTRAINT = 'packaging_associations_protected';\n        END IF;\n    END IF;\n    RETURN NEW;\nEND "
    }
] as const;
export const packagingTriggers = [
    {
        "name": "guard_packaging_reclassification",
        "table": "packagings",
        "event": "BEFORE UPDATE OF classification, \"packagingRole\"",
        "functionName": "guard_packaging_reclassification",
        "arguments": ""
    }
] as const;
