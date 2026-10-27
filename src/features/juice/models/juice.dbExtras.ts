// Complementos PostgreSQL (CHECK / funciones / triggers) de juice. Especias del jugo: exactamente un catálogo de origen.
// Los agrega database/schemaExtras.ts; tablas, columnas, claves e índices viven en los modelos.
export const juiceChecks = [
    {
        "table": "juiceSpices",
        "name": "juice_spices_one_catalog",
        "expression": "(\"ingredientId\" IS NOT NULL) <> (\"spiceMaterialId\" IS NOT NULL)"
    }
] as const;
