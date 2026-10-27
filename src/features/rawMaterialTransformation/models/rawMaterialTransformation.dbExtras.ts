// Complementos PostgreSQL (CHECK / funciones / triggers) de rawMaterialTransformation. Valores de la transformación de materia prima.
// Los agrega database/schemaExtras.ts; tablas, columnas, claves e índices viven en los modelos.
export const rawMaterialTransformationChecks = [
    {
        "table": "unprocessedRawMaterials",
        "name": "unprocessedRawMaterials_costPerPound_check",
        "expression": "btrim(code) <> '' AND btrim(\"displayName\") <> '' AND \"costPerPound\" >= 0"
    },
    {
        "table": "rawMaterialTransformations",
        "name": "rawMaterialTransformations_values_check",
        "expression": "\"yieldPercentage\">0 AND \"yieldPercentage\"<=100 AND \"freightPerPound\">=0 AND \"inputCostUsdPerPound\">=0 AND \"freightUsdPerPound\">=0 AND \"rawMaterialCostUsd\">=0 AND \"directLaborCostUsd\">=0 AND \"packagingCostUsd\">=0 AND \"otherCostUsd\">=0 AND \"processedCostUsd\">=0"
    },
    {
        "table": "rawMaterialTransformationCosts",
        "name": "rawMaterialTransformationCosts_values_check",
        "expression": "btrim(\"conceptName\")<>'' AND \"amount\">=0 AND \"costUsdPerProcessedPound\">=0 AND \"sortOrder\">=0 AND ((\"costBasis\" IN ('per_unit','per_batch') AND \"poundsPerUnit\" IS NOT NULL AND \"poundsPerUnit\">0) OR (\"costBasis\" IN ('per_processed_pound','per_input_pound') AND \"poundsPerUnit\" IS NULL))"
    }
] as const;
