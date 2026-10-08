# Configuración de consumo en Packaging

## Contrato y comportamiento

`Packaging.defaultQuantityBasis` (`per_box` / `per_pallet`) y
`Packaging.defaultQuantityValue` (`NUMERIC(10,2)`, positivo, máximo 99,999,999.99)
son nullable. Ambos completos o ambos vacíos. Solo materiales `pallet` pueden
configurarlos. Registros existentes sin consumo continúan siendo válidos;
**crear una asociación pallet simplificada sin consumo configurado se rechaza**.
No se adivinan reglas por código, nombre, prefijo, grupo o `nameKey`.

La asociación conserva `quantityBasis` y `quantityValue`. El resolver compartido
prioriza configuración explícita, asociación existente y finalmente defaults del
catálogo. Los defaults se copian al crear; no hay sincronización automática.
Cambiar Packaging no cambia asociaciones ni cotizaciones guardadas.

| Configuración administrativa explícita | Forma de consumo | Cantidad |
| --- | --- | --- |
| Cada alternativa de Caja | Por caja | 1 |
| Esquinero (fijo o alternativa) | Por pallet | 4 |
| Tarima fija | Por pallet | 1 |
| Stretch fijo | Por pallet | 93.3 |

Estas filas son ejemplos de configuración aprobada, no una clasificación del código.
Caja y Esquinero pueden utilizar `optionGroupId`. Sin ID son materiales fijos;
con ID son alternativas. Todas las alternativas de un grupo/variante deben
mantener exactamente la misma cantidad y base.
`PackagingGroup` sigue organizando alternativas; renombrarlo no cambia cantidades.
No tiene reglas logísticas.

## Administración y carga del catálogo

CRUD: al seleccionar Paletización aparecen **Forma de consumo**, **Por caja /
Por pallet**, **Cantidad**, y ayuda que explica que aplica a nuevas asociaciones.
Puede dejar ambos campos vacíos para conservar compatibilidad, pero no podrá
crear una asociación simplificada hasta configurarlos. El alta rápida de material
pallet incluye los mismos campos. Pasar a un rol individual/intermedio limpia los
defaults que ya no aplican. Los clientes anteriores que omiten ambos campos al
editar un material pallet conservan sus defaults actuales.

La carga existente **Administración → Empaques** ahora descarga columnas:
Código, Nombre, Rol del material, Costo por unidad (USD), FORMA DE CONSUMO,
CANTIDAD DE CONSUMO. Use POR CAJA / POR PALLET y cantidades positivas. Incluye
los cuatro ejemplos de consumo. El formato anterior de cuatro columnas del
**catálogo** sigue siendo válido y crea registros sin defaults.
Esta carga mantiene su contrato anterior de **altas**: rechaza códigos que ya
existen; no modifica silenciosamente nombres/precios/reglas de registros existentes.
Para materiales existentes use el CRUD o un UPDATE explícito revisado por código
(ver más abajo); no borre/reimporte materiales usados por variantes.

## Formularios de asociaciones

Pallet: al seleccionar material se muestra el consumo del catálogo. Guardar copia
la regla sin pedirla nuevamente. Al editar se muestra y conserva la regla efectiva
existente, incluso si difiere del catálogo. Cambiar a otro Packaging copia el
default de ese nuevo material. **Personalizar regla para esta variante** habilita
base/cantidad, muestra advertencia y valida la excepción; no modifica Packaging.
`per_box` requiere variante activa y `boxesPerPallet` finito/positivo.

Individual: nuevas asociaciones usan `quantityPerUnit=1` automáticamente. El
campo interno sigue existiendo; editar una asociación existente permite conservar
sus excepciones. Intermedio conserva la lógica existente de
`unitsPerIntermediatePackage` y no recibe reglas nuevas.

## Excel de asociaciones

La plantilla oficial tiene **exactamente cuatro columnas** y la hoja principal
vacía; Instrucciones y Grupos son hojas auxiliares.

| CÓDIGO SKU | CÓDIGO MP | GRUPO DE OPCIONES | PREDETERMINADO |
| --- | --- | --- | --- |
| PTC1010105 | ME-BHEB0010 | BOLSAS (BAGS) | SI |
| PTC1010105 | ME-CHEB0007 | CAJAS (BOX) | SI |
| PTC1010105 | ME-EG0001 | | |
| PTC1010105 | ME-ESQ001 | | |
| PTC1010105 | ME-TAR001 | | |
| PTC1010105 | ME-STR001 | | |

Use códigos/grupos existentes activos. Los nombres de grupo de este ejemplo son
registros normales que pueden renombrarse. Sin grupo, predeterminado vacío (o NO)
es válido y SI se rechaza. Con grupo, SI/NO explícito es obligatorio; vacío no se
convierte en NO. También se admite YES según idioma. Los aliases booleanos
anteriores permanecen para legacy. El estado final, incluidas hermanas activas
no importadas, debe tener exactamente un default por grupo/variante. No hay
auto-democión en importación: para intercambiar defaults incluya ambas filas.

UNIT nuevo: 1 por unidad. UNIT existente: conserva cantidad efectiva si no se
indica cantidad legacy. INTERMEDIATE: usa configuración de variante, sin cantidad
propia. PALLET nuevo: copia defaults completos; si faltan, error que incluye Código
MP. PALLET existente: conserva regla efectiva; cambios de grupo/default/actividad
pueden actualizar la asociación, pero cambios del catálogo solos no lo hacen.

El preview muestra fila, SKU, código/nombre real del material, nivel, grupo o
Material fijo, predeterminado o —, consumo traducido, origen de regla, costo,
estado, valores anteriores, errores y advertencias. Una regla 1 por caja con
198 cajas/pallet muestra **1 por caja · 198 por pallet**, pero guarda solamente
`per_box / 1`. Sin cambios no ejecuta UPDATE.

El hash incluye ambos defaults del Packaging, actividad, nombres/costos, grupos,
logística y asociaciones. Confirmación relee y bloquea datos en transacción
SERIALIZABLE; errores, cambios desde preview o conflictos de concurrencia causan
rollback y exigen nueva validación. Frontend conserva archivo y hash hasta confirmar.

Formato legacy temporal: BASE DE CANTIDAD y CANTIDAD son configuración explícita
para pallet y tienen prioridad sobre catálogo/asociación. Si aparece cualquiera
de esas columnas, la fila pallet debe completar ambas. No se ignoran ni se
reemplazan valores inválidos/vacíos con defaults. Unit acepta su regla legacy
`per_unit / 1`; intermedio requiere columnas vacías. Columnas informativas de
nombre/costo generan advertencias y nunca modifican el catálogo.

## Actualización de la base existente, sin borrar datos

Orden obligatorio: **schema → backend → frontend → configurar defaults → importar
asociaciones**. No se ejecutó SQL de actualización ni escrituras de datos. La auditoría sí consultó
la base configurada mediante una transacción de solo lectura.

1. Verifique que la instalación anterior ya tenga `quantityBasis` y `optionGroupId`
   en asociaciones y el catálogo `packagingGroups`; si no, siga primero
   `pallet-material-rules.md`.
2. Ejecute `packaging-consumption-schema.sql` contra la base correcta mediante su
   herramienta PostgreSQL. Agrega enum y dos columnas nullable, sin defaults de datos.
   Es idempotente y agrega un CHECK de coherencia. No elimina ni recrea tablas.
3. LOCAL: el proyecto mantiene `npm run dev:sync` / `DB_SYNC_ALTER=true` para
   desarrollo, pero el SQL específico anterior es preferible para limitar el cambio
   a estas columnas y agregar también el CHECK. Luego use `npm run dev` con alter
   desactivado. No ejecute ambos mecanismos simultáneamente.
4. STAGING/PRODUCCIÓN: aplicar el SQL primero, con revisión del cambio habitual.
   Mantener `DB_SYNC_ALTER=false`. Producción ya ignora alter en `connectDB`.
   Construir backend con `npm run build` e iniciar/desplegar con `npm start`.
   Construir frontend con `npm run build` y desplegar `dist` según proceso existente.
5. Ejecutar `packaging-consumption-audit.sql` (solo SELECT). Reporta asociaciones
   activas/inactivas, combinaciones observadas, candidatos uniformes y conflictos.
   Uniformidad no autoriza escritura automática; revise incluso candidatos.
   La auditoría del 2026-10-06 encontró **50 materiales pallet activos, 0 defaults
   configurados y 0 asociaciones pallet**. No hay candidatos uniformes ni conflictos;
   los 50 requieren configuración explícita. Ambas columnas nuevas ya estaban
   presentes en la base auditada. Resultados en `packaging-consumption-audit-result.json`.
   Puede repetir el reporte pre/postdeploy con `node scripts/audit-packaging-consumption.cjs`;
   no ejecuta sync/seeders y fuerza READ ONLY.
6. Configurar defaults explícitamente en CRUD o al crear catálogo por Excel.
   Para actualizar muchos Packaging existentes mediante SQL, use códigos exactos
   revisados, sin inferencia ni joins por nombre; por ejemplo:

```sql
BEGIN;
WITH approved(code, basis, quantity) AS (VALUES
  ('CODIGO_CAJA_REAL', 'per_box', 1::numeric),
  ('CODIGO_ESQUINERO_REAL', 'per_pallet', 4::numeric),
  ('CODIGO_TARIMA_REAL', 'per_pallet', 1::numeric),
  ('CODIGO_STRETCH_REAL', 'per_pallet', 93.3::numeric)
)
UPDATE "packagings" p
SET "defaultQuantityBasis" = approved.basis::"enum_packagings_defaultQuantityBasis",
    "defaultQuantityValue" = approved.quantity,
    "updatedAt" = CURRENT_TIMESTAMP
FROM approved
WHERE p."code" = approved.code AND p."packagingRole" = 'pallet'
RETURNING p."id", p."code", p."defaultQuantityBasis", p."defaultQuantityValue";
-- Verificar que RETURNING contiene exactamente todos los códigos aprobados.
-- COMMIT solamente después de verificar; si faltan códigos, ROLLBACK y corregir.
```

7. Descargar plantilla nueva desde Productos, completar cuatro columnas, validar,
   revisar preview y confirmar. Corregir configuración del catálogo si se reporta
   consumo faltante; no escribir cantidades en la plantilla nueva.

No se migran reglas de asociaciones, ni se recalculan quotes, ni se rellenan
defaults por nombre. Las filas existentes quedan con valores NULL en catálogo.
Las asociaciones existentes no precisan defaults para seguir funcionando.

## Cotizador, históricos y Stretch

No se modifica matemática ni snapshots. Pallet por caja:
`quantityValue × boxesPerPallet × requestedPallets`. Por pallet:
`quantityValue × requestedPallets`. Individual:
`quantityPerUnit × boxesPerPallet × bagsPerBox × requestedPallets`. Intermedio:
`ceil(totalUnits / unitsPerIntermediatePackage)` según motor existente.
Costo utiliza Packaging seleccionado. Los nuevos defaults nunca son fuente
logística del cotizador. `bagsPerBox` sigue mapeando la columna física `unitsPerBox`.
Quote.breakdown guardado y PDF histórico siguen usando snapshot; previews de
cotizaciones nuevas usan las asociaciones vigentes. No se actualizan históricos.

Packaging no tiene unidad de medida estructurada. Stretch muestra **93.3 por
pallet**; no se asume que significa metros por su nombre. Configurar costo por
unidad de consumo correctamente sigue siendo responsabilidad del catálogo.

## Verificación

Pruebas de schemas/defaults, carga de catálogo, copia/preservación manual, cuatro
columnas/legacy, grupos/fijos, defaults, enriquecimiento/traducciones, hash,
repreview y rollback. La suite completa verifica también matemáticas y flujos de
cotizaciones/históricos existentes. Resultados finales: **82 suites / 1211 pruebas**, 59 adicionales frente a 1152.
Typecheck y build backend/frontend aprobados; lint frontend y archivos backend de
este cambio aprobado. Backend no posee script lint propio: se utilizó Oxlint
instalado en frontend. El build frontend conserva el aviso de chunks grandes.
No se probó confirmación/escrituras contra PostgreSQL real ni navegador interactivo;
la auditoría fue una consulta real de solo lectura. Rollback se verifica con
transacciones mockeadas, no reemplaza una prueba de integración contra PostgreSQL.

## Archivos de esta implementación

Backend, bajo `src/features/`:

- `packaging/models/Packaging.model.ts`
- `packaging/schemas/packaging.schema.ts`
- `packaging/constants/packagingImport.constant.ts`
- `packaging/services/packaging.service.ts` y `.test.ts`
- `packaging/services/packagingConsumption.service.ts` y `.test.ts` (nuevos)
- `product/schemas/productVariantPalletMaterial.schema.ts` y `.test.ts`
- `product/services/productVariantPalletMaterial.service.ts` y `.test.ts`
- `product/services/productPackagingImport.service.ts` y `.test.ts`
- `product/controllers/productPackagingImport.controller.ts`
- `product/routes/productPackagingImport.routes.test.ts`
- `quote/services/quote.service.test.ts` (solo prueba nueva; motor sin cambios)

Frontend, bajo `src/feature/`:

- `packaging/schema/packaging.schema.ts`
- `packaging/component/packagingConsumptionFields.component.tsx` (nuevo)
- `packaging/component/packagingForm.component.tsx`
- `packaging/component/createPalletMaterialModal.component.tsx`
- `packaging/page/createPackaging.page.tsx`
- `packaging/page/editPackaging.page.tsx`
- `product/schema/productVariantPalletMaterial.schema.ts`
- `product/component/productVariantPalletMaterialSection.component.tsx`
- `product/component/productVariantUnitMaterialSection.component.tsx`
- `product/api/productPackagingImport.api.ts`
- `product/component/productPackagingImportPanel.component.tsx`

También traducciones ES/EN de ambos proyectos, esta guía, scripts de schema/auditoría
y actualización de `product-packaging-import.md` / `pallet-material-rules.md`.
Los cambios anteriores del workspace permanecen; esta lista describe únicamente
la simplificación actual. No se modificó `.env`, snapshots/PDF ni datos reales. Se agregó también
`scripts/audit-packaging-consumption.cjs` y su reporte JSON de solo lectura.
