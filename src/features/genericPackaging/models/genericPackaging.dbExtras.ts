// Complementos PostgreSQL (CHECK / funciones / triggers) de genericPackaging. Configuraciones genéricas de empaque.
// Los agrega database/schemaExtras.ts; tablas, columnas, claves e índices viven en los modelos.
export const genericPackagingChecks = [
    {
        "table": "genericPackagingConfigurations",
        "name": "gpc_bags_per_box_check",
        "expression": "\"bagsPerBox\">0 AND \"bagsPerBox\"<=100000"
    },
    {
        "table": "genericPackagingConfigurations",
        "name": "gpc_boxes_per_pallet_check",
        "expression": "\"boxesPerPallet\">0 AND \"boxesPerPallet\"<=100000"
    },
    {
        "table": "genericPackagingConfigurations",
        "name": "gpc_intermediate_capacity_check",
        "expression": "\"unitsPerIntermediatePackage\">0 AND \"unitsPerIntermediatePackage\"<=100000"
    },
    {
        "table": "genericPackagingConfigurationGroups",
        "name": "gpcg_level_check",
        "expression": "level IN ('unit','intermediate','pallet')"
    },
    {
        "table": "genericPackagingConfigurationGroups",
        "name": "gpcg_selection_mode_check",
        "expression": "\"selectionMode\" IN ('one','all')"
    },
    {
        "table": "genericPackagingConfigurationMaterials",
        "name": "gpcm_quantity_basis_check",
        "expression": "\"quantityBasis\" IN ('per_unit','per_intermediate','per_box','per_pallet')"
    },
    {
        "table": "genericPackagingConfigurationMaterials",
        "name": "gpcm_consumption_check",
        "expression": "(\"quantityBasis\"='per_intermediate' AND \"quantityValue\" IS NULL) OR (\"quantityBasis\"<>'per_intermediate' AND \"quantityValue\">0 AND \"quantityValue\" IS NOT NULL)"
    }
] as const;
export const genericPackagingFunctions = [
    {
        "name": "guard_generic_packaging_assignment",
        "body": "\nDECLARE material_classification TEXT; material_role TEXT; group_level TEXT;\nBEGIN\n SELECT classification, \"packagingRole\" INTO material_classification, material_role FROM packagings WHERE id = NEW.\"packagingId\" FOR SHARE;\n SELECT level INTO group_level FROM \"genericPackagingConfigurationGroups\" WHERE id = NEW.\"configurationGroupId\" FOR SHARE;\n IF material_classification IS DISTINCT FROM 'generic' OR material_role IS DISTINCT FROM group_level\n OR (group_level = 'unit' AND NEW.\"quantityBasis\" <> 'per_unit')\n OR (group_level = 'intermediate' AND NEW.\"quantityBasis\" <> 'per_intermediate')\n OR (group_level = 'pallet' AND NEW.\"quantityBasis\" NOT IN ('per_box','per_pallet')) THEN\n RAISE EXCEPTION 'Invalid generic packaging association' USING ERRCODE = '23514', CONSTRAINT = 'generic_packaging_assignment';\n END IF;\n RETURN NEW;\nEND "
    },
    {
        "name": "protect_generic_packaging_references",
        "body": "\nBEGIN\n IF (NEW.classification IS DISTINCT FROM OLD.classification OR NEW.\"packagingRole\" IS DISTINCT FROM OLD.\"packagingRole\")\n AND EXISTS (SELECT 1 FROM \"genericPackagingConfigurationMaterials\" WHERE \"packagingId\" = OLD.id) THEN\n RAISE EXCEPTION 'Packaging has generic configuration references' USING ERRCODE = '23514', CONSTRAINT = 'packaging_associations_protected';\n END IF;\n RETURN NEW;\nEND "
    },
    {
        "name": "protect_generic_group_level",
        "body": "\nBEGIN\n IF NEW.level IS DISTINCT FROM OLD.level AND EXISTS (SELECT 1 FROM \"genericPackagingConfigurationMaterials\" WHERE \"configurationGroupId\" = OLD.id) THEN\n RAISE EXCEPTION 'Group has material references' USING ERRCODE = '23514', CONSTRAINT = 'generic_packaging_assignment';\n END IF;\n RETURN NEW;\nEND "
    }
] as const;
export const genericPackagingTriggers = [
    {
        "name": "guard_generic_packaging_assignment",
        "table": "genericPackagingConfigurationMaterials",
        "event": "BEFORE INSERT OR UPDATE",
        "functionName": "guard_generic_packaging_assignment",
        "arguments": ""
    },
    {
        "name": "protect_generic_packaging_references",
        "table": "packagings",
        "event": "BEFORE UPDATE OF classification, \"packagingRole\"",
        "functionName": "protect_generic_packaging_references",
        "arguments": ""
    },
    {
        "name": "protect_generic_group_level",
        "table": "genericPackagingConfigurationGroups",
        "event": "BEFORE UPDATE OF level",
        "functionName": "protect_generic_group_level",
        "arguments": ""
    }
] as const;
