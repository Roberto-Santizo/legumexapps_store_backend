# Carga masiva de materiales de empaque por variante

La pantalla está en **Administración → Productos**, debajo de las cargas existentes
(Productos/Variantes, Recetas e Ingredientes), en el panel **Materiales de empaque
por variante**. Requiere `products:edit` tanto para mostrar el panel como para los
endpoints. El botón final confirma los cambios que se mostraron en el preview.

## Arquitectura auditada y reutilizada

- Productos y variantes: `productImport.service.ts`, endpoints de
  `product.routes.ts`. Se conservan sin cambios.
- Catálogo maestro Packaging: `packaging.service.ts`, endpoints
  `/packagings/bulk-import` y `/packagings/bulk-import/template`. Este flujo ya
  permite crear materiales completos; se utiliza primero cuando falta un Código MP.
- Recetas e ingredientes: sus servicios de importación y paneles se conservan.
- Parser, encabezados y buffers: `shared/utils/excelImport.util.ts` con ExcelJS.
- Referencias SKU: `productSkuReference.ts` (`skuCodeKey`). Solo SKU de variante;
  no nombres, presentación ni posición.
- Upload: multer en memoria, límite de 5 MiB, igual que las cargas existentes.
- Auth, autorización, `AppError`, `BulkImportError`, `RowIssue`, traducciones
  ES/EN y errores HTTP: infraestructura existente.
- UI: Button, tablas, TanStack Query, Axios de staff y descarga de Blob existente
  extraída a `shared/utils/downloadBlob.ts`. El panel nuevo añade los estados de
  validación/preview/confirmación que el panel genérico de un solo paso no tenía.

## Archivos y endpoints

Backend, dentro de `src/features/product/`:

- `constants/productPackagingImport.constant.ts`: columnas, aliases y límite.
- `services/productPackagingImport.service.ts`: plantilla, parser, plan completo,
  preview y confirmación transaccional.
- `controllers/productPackagingImport.controller.ts`: archivos y mensajes traducidos.
- `routes/productPackagingImport.routes.ts`: rutas protegidas, montadas en
  `src/routes/index.ts`.

Los tres endpoints, bajo el prefijo habitual `/api`, son:

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/product-packaging-materials/bulk-import/template` | .xlsx con instrucciones y catálogo de grupos activos |
| POST | `/product-packaging-materials/bulk-import/preview` | Multipart `file`; resumen y filas; cero escrituras |
| POST | `/product-packaging-materials/bulk-import/confirm` | Multipart `file` y `previewHash`; revalidación y transacción |

Frontend, dentro de `src/feature/product/`:

- `api/productPackagingImport.api.ts`: contratos Zod y upload/preview/confirmación.
- `component/productPackagingImportPanel.component.tsx`: selección .xlsx, descarga,
  validación, resumen, tabla, errores/advertencias, valores anteriores e importación.
- `page/product.page.tsx`: ubicación del panel y permiso.

Se modificó el panel genérico únicamente para reutilizar la función de descarga.
Los nuevos mensajes están en los archivos habituales `translation.json` ES/EN de
ambos proyectos. No se modificaron motores de cotización ni snapshots históricos.

## Plantilla simplificada vigente

La plantilla oficial tiene exactamente cuatro columnas: CÓDIGO SKU, CÓDIGO MP,
GRUPO DE OPCIONES, PREDETERMINADO. Packaging define los defaults de consumo;
las asociaciones nuevas los copian y las existentes conservan sus reglas.
Con grupo, SI/NO explícito es obligatorio; sin grupo puede quedar vacío.
Consulte [packaging-consumption.md](packaging-consumption.md) para ejemplos,
formatos legacy, formulario manual, validaciones y despliegue del nuevo schema.

## Compatibilidad, códigos, costos y errores

Los códigos se comparan con trim y sin distinguir mayúsculas, igual que las
referencias SKU existentes. No se eliminan acentos ni se usan búsquedas aproximadas.
Si varios Packaging tienen códigos que solo difieren en mayúsculas, la referencia
se rechaza por ambigüedad; nunca se elige arbitrariamente un material.

Se admite el formato anterior con columnas informativas adicionales. `NOMBRE MP`
y `COSTO POR UNIDAD (USD)` son opcionales y generan advertencias si difieren del
catálogo; ninguna columna de este flujo modifica Packaging o su costo. No se
convierten GTQ a USD. `COSTO POR UNIDAD (Q)` y otras columnas desconocidas se ignoran;
si se desea comparar costos, cambiar el encabezado a USD solo cuando sus valores
ya están expresados en USD. Para una fila pallet del formato anterior que carezca
de defaults completos en Packaging se devuelve error; no se adivina su regla. Si
contiene columnas legacy de base/cantidad, ambos valores deben estar completos.

Los SKU inexistentes, variantes/productos/materiales inactivos y códigos MP
inexistentes son errores por fila. Un material inexistente debe cargarse antes
mediante la carga del catálogo maestro. También se rechazan duplicados SKU+MP,
fórmulas (incluyendo valores calculados almacenados), números inválidos, cero o
negativos en cantidades, cantidades fuera del DECIMAL(10,2), base pallet inválida,
grupos inexistentes/inactivos y default de un material fijo. Se requieren cajas y
bolsas por caja positivas en la variante, como las utiliza el motor actual.
Para `per_box` se reporta específicamente la falta de `boxesPerPallet`.

Se permiten únicamente .xlsx, MIME XLSX u octet-stream, máximo 5 MiB y 1000 filas.
Archivos vacíos/corruptos y encabezados faltantes/duplicados se rechazan. Las filas
vacías se ignoran y se conserva su número físico de Excel en cada error.

## Existentes, grupos y transacción

El preview distingue NUEVO, ACTUALIZACIÓN, SIN CAMBIOS y ERROR. Para actualizaciones
muestra la configuración anterior, incluyendo si la asociación estaba inactiva.
Una asociación inactiva se reactiva mediante update y se muestra como actualización;
no se intenta insertar otra fila contra su índice único. Filas sin cambios no se
escriben. Asociaciones activas de otro nivel para el mismo SKU+material se rechazan
para evitar duplicar el consumo después de un cambio de rol en el catálogo.

Los grupos se resuelven por su nombre único normalizado (`PackagingGroup.nameKey`);
la plantilla presenta nombres, sin IDs. Unit y pallet guardan `optionGroupId` interno.
Vacío significa material fijo. Se aceptan SI/NO, TRUE/FALSE, YES/NO o 1/0, con trim,
mayúsculas y acentos controlados. Vacío significa false. Valores como X o "tal vez"
son errores. Un grupo activo debe terminar con exactamente un predeterminado.

Se valida el estado final de cada grupo afectado y nivel, incluyendo asociaciones
existentes no incluidas en el archivo. La importación no desmarca defaults en
silencio. Para cambiar el predeterminado, incluir la asociación anterior con NO y
la nueva con SI. Las alternativas pallet de un mismo grupo/variante deben tener
la misma base y cantidad. Cambiar o sacar el default dejando otras alternativas
sin predeterminado bloquea la importación.

El preview no escribe. La confirmación reenvía el archivo original y su hash de
preview. El servidor vuelve a parsear y validar TODO dentro de una transacción
administrada de Sequelize con aislamiento SERIALIZABLE y locks sobre las filas
consultadas. El hash vincula datos normalizados y estado relevante de catálogos,
variantes y asociaciones; un cambio exige un nuevo preview. Ninguna escritura
comienza si hay errores. Todas las operaciones create/update reciben la misma
transacción. Cualquier fallo lanza una excepción y Sequelize hace rollback.
Conflictos de concurrencia requieren revalidar; no se reintentan escrituras
silenciosamente. No se crea ni modifica el catálogo maestro.

## Cantidades y unidades

Para 40 cajas/palet, 12 unidades/caja y 2 palets, se conservan las reglas del motor:

- Unit: 1 × 40 × 12 × 2 = 960.
- Caja: 1 × 40 × 2 = 80.
- Esquinero: 4 × 2 = 8.
- Tarima: 1 × 2 = 2.
- Stretch: 93.3 × 2 = 186.6, cuando el costo del Packaging está configurado por metro.

**Limitación existente:** Packaging no posee unidad de medida estructurada ni FK
al catálogo Unit. El importador no puede certificar "metros" versus "unidades" por
nombres/cantidades. Preview conserva la cantidad y base y muestra esta limitación;
no se añadió un segundo sistema de unidades ni se reescribieron breakdown/PDF
históricos. Unidades estructuradas y su presentación en nuevos PDFs requieren una
decisión de modelo posterior. Las pruebas verifican los consumos numéricos.

## Orden de despliegue

Schema (incluidas nuevas columnas nullable de Packaging), backend, frontend,
configuración explícita del catálogo e importación de asociaciones. Los pasos
exactos, SQL idempotente y consulta de auditoría están documentados en
[packaging-consumption.md](packaging-consumption.md).
No se ejecutaron cambios sobre una base real durante esta implementación.
La auditoría de solo lectura encontró 50 Packaging pallet sin defaults ni asociaciones.

## Pruebas y verificación

`services/productPackagingImport.service.test.ts` usa Excel reales creados en
memoria y mocks de modelos: validación completa, archivos/headers/fórmulas,
identificadores, activos, roles, números, duplicados, grupos/defaults con existentes,
consistencia, cinco reglas, intermediate, advertencias USD, update/reactivación,
sin cambios, preview obsoleto, bloqueo sin escrituras, opciones de transacción y
propagación de falla para rollback completo.

`routes/productPackagingImport.routes.test.ts` verifica autorización, límite/MIME/
extensión, preview traducido, confirmación, errores por fila y descarga de plantilla.
`quote.service.test.ts` incluye el ejemplo matemático anterior y selección de las
alternativas de Caja y Esquinero sin modificar el motor.

Las pruebas de rollback usan el patrón del repositorio con Sequelize mockeado;
no equivalen a una prueba contra PostgreSQL real. La UI se verifica por typecheck,
lint y build; no hay un runner de pruebas de componentes instalado en el proyecto.

### Resultados de la simplificación actual

- Suite completa backend: **82 suites, 1211 pruebas aprobadas**.
- **59 pruebas adicionales** respecto del estado anterior (1152).
- Backend build/typecheck y frontend typecheck/build: aprobados.
- Lint frontend y archivos backend de este cambio: aprobados con Oxlint.
- Vite mantiene el aviso de chunks grandes; build exitoso.
- Confirmación/rollback se prueban con modelos mockeados; auditoría de datos real
  mediante SELECT en transacción READ ONLY. Sin prueba interactiva de navegador.

Contratos HTTP y archivos Excel reales se prueban con modelos mockeados. La prueba
nueva del cotizador verifica el ejemplo 198 × 6 × 2, ignora defaults globales al
calcular y conserva el snapshot guardado tras cambios de catálogo.
