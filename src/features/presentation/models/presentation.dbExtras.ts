// Complementos PostgreSQL (CHECK / funciones / triggers) de presentation. Volumen neto de la presentación.
// Los agrega database/schemaExtras.ts; tablas, columnas, claves e índices viven en los modelos.
export const presentationChecks = [
    {
        "table": "presentations",
        "name": "presentations_netVolumeMl_check",
        "expression": "\"netVolumeMl\">0"
    }
] as const;
