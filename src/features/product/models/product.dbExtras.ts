// Complementos PostgreSQL (CHECK / funciones / triggers) de product. Materiales de empaque del SKU (usan guard_packaging_assignment de packaging).
// Los agrega database/schemaExtras.ts; tablas, columnas, claves e índices viven en los modelos.
export const productTriggers = [
    {
        "name": "guard_unit_packaging",
        "table": "productVariantUnitMaterials",
        "event": "BEFORE INSERT OR UPDATE OF \"packagingId\"",
        "functionName": "guard_packaging_assignment",
        "arguments": "'unit'"
    },
    {
        "name": "guard_intermediate_packaging",
        "table": "productVariantIntermediateMaterials",
        "event": "BEFORE INSERT OR UPDATE OF \"packagingId\"",
        "functionName": "guard_packaging_assignment",
        "arguments": "'intermediate'"
    },
    {
        "name": "guard_pallet_packaging",
        "table": "productVariantPalletMaterials",
        "event": "BEFORE INSERT OR UPDATE OF \"packagingId\"",
        "functionName": "guard_packaging_assignment",
        "arguments": "'pallet'"
    }
] as const;
