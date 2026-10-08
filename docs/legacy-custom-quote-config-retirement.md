# Retiro seguro de la configuración legacy de cotizaciones

Auditoría y limpieza: 8 de octubre de 2026. Alcance exclusivo: administración de las cuatro listas antiguas y superficie HTTP de creación legacy. No es la unificación de Productos/Jugos ni de costos.

## Decisión y evidencia

La pantalla administrativa `Configuración de cotizaciones a la medida` configuraba el flujo anterior: producto sin SKU, límites de materias primas/ingredientes, logística por presentación y empaques globales. Ese formulario público ya estaba eliminado en el estado inicial del frontend.

El backend aún exponía el catálogo, preview y guardado anteriores. Eran consumidores reales de las tablas en el código; por eso primero se retiró esa superficie HTTP. No se encontraron llamadas a esos endpoints en el frontend actual ni en los scripts operativos inspeccionados. No se verificaron integraciones externas ni tráfico de producción.

El nuevo Customize sigue esta cadena, independiente de las listas legacy:

1. `SiteRoutes.tsx`: `/solicitud/a-la-medida` carga `catalogQuoteRequest.page.tsx`.
2. `catalogQuote.api.ts`: GET `/custom-quotes/configurations`, POST `/custom-quotes/catalog-preview` y POST `/custom-quotes/catalog-confirm`.
3. `catalogQuoteDiscovery.service.ts::loadCatalogContext`: consulta Category/SubCategory activos, Product/ProductRawMaterial/RawMaterial/Unit y ProductVariant/Presentation con sus tres asociaciones de Packaging.
4. `availableRawMaterials`: filtra por subcategoría, actividad, `isMixable`, `ingredientType` y unidad de costo válida. Discovery expone la certificación; el wizard filtra tipo/certificación y el cálculo vuelve a validar ambos.
5. `catalogQuote.service.ts::calculateCatalogQuote`: valida categoría/subcategoría, configuración, tipo/certificación, duplicados y suma exactamente 100%; selecciona empaques de las asociaciones de la variante y usa los constructores monetarios compartidos.
6. Preview/confirm conservan lectura consistente, token de preview, control de cambios e idempotencia. Confirm guarda `CustomQuote` con `configurationOrigin=catalog_variant`, snapshot versión 2 y breakdown congelado.
7. El calculador interno usa `adminCatalogQuote.controller.ts` y `previewAdminCatalogQuote`, sin persistir; no usa listas legacy.

Ninguno de los pasos consulta CustomQuoteRawMaterialOption, CustomQuoteIngredientOption, CustomQuotePresentationOption o CustomQuotePackagingOption. La suite del servicio ahora comprueba ausencia de `findAll`/`findOne` sobre los cuatro modelos en cada caso de discovery, preview, cálculo y confirm.

## Clasificación

| Elemento | Clase | Decisión |
|---|---|---|
| Pantalla, cuatro tabs/formularios, acciones de fila, hook, API y schema frontend exclusivos | A: obsoleto confirmado | Eliminados |
| Ruta/menu administrativo y traducciones frontend `customQuoteConfig` | A | Eliminados |
| Router/controlador/servicios CRUD y schema backend exclusivos | A | Eliminados |
| Catálogo anterior y su controlador HTTP | A | Eliminados después de retirar los endpoints consumidores |
| Tests de CRUD/catálogo anterior | A | Retirados con la funcionalidad; pruebas HTTP anteriores reemplazadas por pruebas de retiro |
| Permiso `customQuoteConfig:edit` en el seeder | A | Ya no se genera; filas existentes y RolePermission no se borran |
| Componentes de catálogos y empaques, builders de quote, calculador Ready-made | B: compartido | Conservados sin cambios |
| Catalog discovery/identity/service, controllers y schemas actuales | B | Conservados; solo se refuerzan tests |
| CustomQuote, adminCustomQuoteService, estados, schemas/lectores y composición de documentos | C: histórico y actual | Conservados |
| Cuatro modelos de opciones, constantes de cantidad y registro Sequelize | C/E: estructura legacy conservada; datos reales inciertos | Conservados intactos |
| `customQuote.service.ts`, `customQuote.schema.ts`, tests de motor/paridad anteriores | Retención explícita de alcance | Conservados intactos, sin controlador/ruta pública; la solicitud prohíbe modificar motores de cálculo |
| Traducciones backend de recursos/opciones/errores y nombre de permiso | C/retención | Conservadas: modelos/motor retenidos y permisos existentes pueden seguir apareciendo en la administración de roles |
| Integraciones externas o consumidores fuera de este repositorio | E: incierto | No se verificaron; comprobar antes de desplegar |

No quedan dependencias activas de la administración legacy en el código de la aplicación. No se confunde una configuración persistida (`customQuoteConfigurationSchema`) con el schema eliminado de administración (`customQuoteConfig.schema.ts`).

## Archivos frontend eliminados (9)

Todos bajo `src/feature/customQuote/`:

- `page/customQuoteConfig.page.tsx`
- `component/customQuoteRawMaterialOptionsSection.component.tsx`
- `component/customQuoteIngredientOptionsSection.component.tsx`
- `component/customQuotePresentationOptionsSection.component.tsx`
- `component/customQuotePackagingOptionsSection.component.tsx`
- `component/customQuoteOptionRowActions.component.tsx`
- `component/useCustomQuoteOptionMutations.ts`
- `api/customQuoteConfig.api.ts`
- `schema/customQuoteConfig.schema.ts`

Además: eliminación puntual del lazy import/ruta en `AdminRoutes.tsx`, entrada de `adminNavigation.ts`, namespace de traducciones ES/EN y una prueba de navegación en `scripts/catalog-quote.test.cjs`. `SlidersHorizontal` se conserva porque lo utiliza la configuración de jugos.

## Archivos backend eliminados (13)

Todos bajo `src/features/customQuote/`:

- `controllers/customQuoteConfig.controller.ts`
- `controllers/customQuote.controller.ts`
- `routes/customQuoteConfig.routes.ts`
- `schemas/customQuoteConfig.schema.ts`
- `services/customQuoteRawMaterialOption.service.ts`
- `services/customQuoteIngredientOption.service.ts`
- `services/customQuotePresentationOption.service.ts`
- `services/customQuotePackagingOption.service.ts`
- `services/customQuoteCatalog.service.ts`
- `routes/customQuoteConfig.routes.test.ts`
- `services/customQuoteConfigOptions.service.test.ts`
- `services/customQuotePackagingOption.service.test.ts`
- `services/customQuoteCatalog.service.test.ts`

Además: eliminación puntual del montaje en `src/routes/index.ts`, de endpoints en `customQuote.routes.ts` y del permiso exclusivo en `accessControl.seeder.ts`. Se actualizan los tests de rutas y se amplían los tests de CatalogQuote e historial. No se modifica la conexión, el registro de modelos ni el arranque del servidor.

## Endpoints retirados

- `/admin/custom-quote-config/raw-materials`
- `/admin/custom-quote-config/ingredients`
- `/admin/custom-quote-config/presentations`
- `/admin/custom-quote-config/packagings`

Para cada recurso: GET lista, GET `/:id`, POST, PATCH `/:id` y PATCH `/:id/status` (20 contratos CRUD). La ruta administrativa frontend `/admin/custom-quote-config` también desaparece.

También se retiran GET `/custom-quotes/catalog`, POST `/custom-quotes/preview` y POST `/custom-quotes` del flujo anterior. Con JWT válido devuelven 404 y no llegan al cálculo ni a la persistencia. Se mantienen íntegros los endpoints `/configurations`, `/catalog-preview`, `/catalog-confirm`, los del calculador interno, `/admin/custom-quotes` y PDF/email.

## Tablas y dependencias

No se consultó la base de datos real. Los conteos indicados por el usuario como vacíos no se presentan como verificados. El SQL separado `legacy-custom-quote-config-inventory.sql` contiene únicamente un inventario de lectura; está preparado y NO ejecutado.

| Tabla | Datos reales | FK salientes en los modelos | Lectura del nuevo Customize/historial | Retiro físico |
|---|---|---|---|---|
| `customQuoteRawMaterialOptions` | No verificados | subCategoryId → SubCategory; rawMaterialId → RawMaterial | No | Pendiente |
| `customQuoteIngredientOptions` | No verificados | ingredientId → Ingredient | No | Pendiente |
| `customQuotePresentationOptions` | No verificados | presentationId → Presentation | No | Pendiente |
| `customQuotePackagingOptions` | No verificados | packagingId → Packaging | No | Pendiente |

CustomQuote no tiene FK hacia una tabla de opciones. Los IDs `packagingOptionId` en configuration son referencias congeladas dentro de JSON, no asociaciones que el lector histórico resuelva. El motor anterior retenido sí podría consultar las cuatro tablas si se invocara directamente; ya no está expuesto por HTTP. No deben eliminarse los modelos/tablas mientras se conserve ese código y su registro.

Retiro futuro, fuera de esta limpieza: verificar conteos y FK reales, otros esquemas/vistas/triggers y consumidores externos; archivar/respaldar datos; retirar motor/schema/constants exclusivos y registro de modelos conjuntamente, con sus pruebas; solo después preparar una migración revisada. No se prepara DROP mientras esos requisitos siguen pendientes. Nunca usar CASCADE ni sync force/alter para esta limpieza.

## Compatibilidad histórica, PDF y email

`adminCustomQuote.service.ts` incluye únicamente `requestingSalesperson` al leer listado/detalle. Entrega configuration/breakdown congelados; los nombres de versión 2 provienen del snapshot y los históricos sin snapshot usan su contexto ya persistido, sin reconstruir precios desde catálogos actuales. Los nuevos tests abren configuraciones de versiones 1 y 2 aun sin objetos de catálogo actuales.

Se conserva `CustomQuote.model.ts`, sus FK hacia Salesperson/SubCategory/Presentation/Destination/ProductVariant, status y columnas monetarias. No se modifica ninguna CustomQuote confirmada.

`toCustomQuoteDocumentLine` resuelve nombres desde breakdown y porcentajes desde configuration; `customQuoteSpecification`, schemas de detalle, QuoteResultCard y QuotePdfButton se conservan. La página de detalle continúa pasando esas líneas al PDF y a `sendAdminQuotePdfEmailAPI`. El flujo público conserva `sendQuotePdfEmailAPI`. No se envió correo real ni se abrió una cotización de producción.

## Aislamiento y verificación

Se detectaron cambios previos en ambos repositorios. Se crearon dos worktrees separados en `.legacy-config-cleanup/`, se copió el estado actual (incluyendo fuentes no confirmadas) y se guardaron hashes de cada archivo. La transferencia al proyecto comprueba esos hashes y rechaza sobrescribir archivos modificados durante el trabajo. No hay commits, reset ni limpieza masiva.

Los nueve archivos frontend y trece backend eliminados pertenecen exclusivamente al alcance descrito. Productos, ProductVariant, Juice, ProcessingCost, costos globales, imports y motores no se modifican. El motor legacy se retiene precisamente para respetar ese límite.

## Validación

Resultados finales en los worktrees aislados. Las pruebas usan modelos mock; no se arrancó el servidor ni se ejecutó sync, seeders, migraciones o SQL.

| Comprobación | Resultado |
|---|---|
| Jest completo, `node node_modules/jest/bin/jest.js --runInBand --coverage=false` | 84 suites, 1,302 pruebas aprobadas |
| Backend TypeScript, `tsc --noEmit --preserveSymlinks` | Aprobado |
| Backend build, `tsc -p tsconfig.build.json --preserveSymlinks` | Aprobado |
| Frontend `npm test` | 90 pruebas aprobadas |
| Frontend TypeScript, `tsc -b --pretty false` | Aprobado |
| Frontend `npm run lint` (Oxlint) | Aprobado |
| Frontend `npm run build` | Aprobado; advertencia de chunks grandes |

La primera ejecución de Jest aislado aprobó 83 suites y no pudo iniciar una por ausencia de variables requeridas. La repetición completa usó valores ficticios de entorno y una URL local inutilizable, sin credenciales reales: las 84 suites aprobaron. Los comandos backend necesitan `--preserveSymlinks` en el worktree porque comparte `node_modules` mediante junction; sin ese flag TypeScript rechaza tipos de Express provenientes de la ruta original (TS2883). No se altera código de jugos para corregir ese detalle de aislamiento. Después de integrar los cambios, `tsc --noEmit` y `npm run build` también aprobaron en el backend original, sin flags especiales.

La integración verificó 36 archivos: 9 eliminados de frontend, 13 de backend y 14 modificados/agregados. No hubo cambios en ninguna otra fuente `src/` respecto al snapshot inicial. Los artefactos PDF de tests no se transfirieron.

| Cobertura solicitada | Evidencia |
|---|---|
| Discovery, ingredientType, Organic/Conventional, isMixable | CatalogQuote service tests |
| Suma exactamente 100%, configuración ProductVariant, empaques | CatalogQuote service tests + tests UI/estado |
| Preview/confirm, persistencia, snapshot, conflictos e idempotencia | CatalogQuote service y route tests |
| Administración, estados y versiones históricas 1/2 | adminCustomQuote service/route tests; schemas/mapper frontend |
| PDF/email y Ready-made | Tests de composición, quote-pdf-packaging, quote-order, schemas y rutas/servicios de Quote |
| Menú/ruta eliminados, imports válidos y endpoints frontend | Test de navegación, test de API CatalogQuote, TypeScript y build |
| Endpoints legacy retirados | customQuote.routes.test.ts; comprobación del montaje administrativo |

Riesgos pendientes: datos/referencias reales no inspeccionados; posible cliente externo del API anterior; enlaces guardados a la página retirada llevarán a la ruta de no encontrado existente; conservación temporal deliberada de modelos/motor/schema legacy. El build frontend puede mantener su advertencia de chunks grandes, ajena a esta limpieza.

## Estado final

```text
LEGACY CONFIG AUDITED: YES
LEGACY FRONTEND REMOVED: YES
LEGACY BACKEND REMOVED: PARTIAL
CUSTOMIZE PRESERVED: YES
CUSTOMQUOTE HISTORY PRESERVED: YES
DATABASE DATA DELETED: NO
PRODUCT/JUICE ANALYSIS AFFECTED: NO
```

Backend PARTIAL describe la conservación deliberada de modelos, tablas, constantes y motor anterior. La administración CRUD legacy y sus endpoints HTTP se retiraron por completo. Las garantías de compatibilidad son de código y pruebas; no son una verificación de datos o correos de producción.
