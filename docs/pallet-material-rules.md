# Reglas explícitas de paletización

Cada asociación ProductVariantPalletMaterial almacena packagingId, optionGroupId,
quantityBasis y quantityValue. El nombre del grupo o del Packaging nunca determina
la cantidad. Los grupos de Caja y Esquinero pueden tener cualquier número de alternativas;
se selecciona una por grupo y todas conservan la misma base y cantidad por variante.

| Asociación | optionGroupId | quantityBasis | quantityValue |
| --- | --- | --- | --- |
| Cada alternativa de Caja | ID del grupo de cajas | per_box | 1 |
| Cada alternativa de Esquinero | ID del grupo de esquineros | per_pallet | 4 |
| Tarima fija | null | per_pallet | 1 |
| Stretch fijo (costo por unidad de consumo) | null | per_pallet | 93.3 |

Costo = quantityValue × (boxesPerPallet si per_box; 1 si per_pallet)
× requestedPallets × costo del Packaging seleccionado.

El formulario copia los defaults estructurados del Packaging al crear una asociación;
al editar conserva su regla efectiva. La personalización es explícita y avanzada.
Consulte [packaging-consumption.md](packaging-consumption.md) para actualizar
Packaging, el SQL de nuevas columnas y la plantilla de cuatro columnas. El servicio rechaza crear
o editar una alternativa con una regla distinta de las otras alternativas activas
que comparten grupo y variante, antes de modificar defaults.

## Actualización de instalaciones existentes

En desarrollo, el mecanismo existente DB_SYNC_ALTER agrega las columnas del modelo.
En producción, agregar las columnas antes de iniciar el backend mediante el proceso
de cambios de esquema habitual. El siguiente SQL es idempotente y presupone que el
catálogo packagingGroups ya existe:

```sql
BEGIN;
DO $$ BEGIN
    CREATE TYPE "enum_productVariantPalletMaterials_quantityBasis" AS ENUM ('per_box', 'per_pallet');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "productVariantPalletMaterials"
    ADD COLUMN IF NOT EXISTS "quantityBasis" "enum_productVariantPalletMaterials_quantityBasis" NOT NULL DEFAULT 'per_pallet',
    ADD COLUMN IF NOT EXISTS "optionGroupId" INTEGER REFERENCES "packagingGroups" ("id") ON UPDATE CASCADE ON DELETE SET NULL;
COMMIT;
```

La base inicial per_pallet conserva el cálculo anterior de filas existentes; no
clasifica materiales por sus nombres. Revisar las asociaciones existentes por sus
IDs y guardar las reglas de la tabla anterior explícitamente, especialmente cajas
que antes almacenaban la cantidad total por palet. El seeder convierte etiquetas de
grupos existentes a IDs del catálogo sin modificar cantidades ni snapshots de
cotizaciones. Este cambio de código no ejecuta operaciones sobre la base de datos.
