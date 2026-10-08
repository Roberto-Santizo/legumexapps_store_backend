# Carga inicial conjunta de productos y materiales

## Uso

Administración → Productos → paso 1, Productos y Variantes:

1. Descargar la nueva plantilla .xlsx.
2. Completar **Productos y Variantes**: una fila por variante; repetir el mismo Grupo de producto para variantes del mismo producto.
3. Completar **Materiales de Empaque**: una fila por asociación. SKU debe pertenecer a la primera hoja del mismo archivo.
4. Seleccionar archivo, **Validar**, revisar ambas tablas y el resumen, y **Confirmar carga conjunta**.
5. Configurar imágenes y cargar recetas/ingredientes después, mediante los flujos existentes.

Antes de cargar, deben existir Presentaciones, Clientes, Categorías/Subcategorías y los códigos Packaging activos. Si hay alternativas, sus PackagingGroup deben existir y estar activos. No es necesario configurar defaults de Packaging para Caja, Esquinero, Tarima o Stretch si actualmente están vacíos.

Esta mejora no agrega columnas a la base de datos ni requiere migración, seeders o ejecutar SQL. No importa automáticamente ningún archivo ni modifica datos maestros.

## Hoja 1: Productos y Variantes

Las 14 columnas conservadas son:

| Columna | Uso |
|---|---|
| GRUPO DE PRODUCTO | Clave explícita que agrupa variantes de un producto; no se deduce del nombre. |
| SKU / NÚMERO DE ARTÍCULO | SKU nuevo, único globalmente sin distinguir mayúsculas. |
| PRESENTACIÓN | Presentación activa existente. |
| CAJAS POR PALET | Entero positivo boxesPerPallet. |
| BOLSAS POR CAJA | Entero positivo bagsPerBox. |
| UNIDADES POR EMPAQUE INTERMEDIO | Configuración opcional de la variante; necesaria para asociar INTERMEDIO. |
| SUBCATEGORÍA | Subcategoría activa existente. |
| CATEGORÍA | Opcional; desambigua subcategorías. |
| CLIENTE | Cliente activo existente. |
| NOMBRE DEL PRODUCTO | Nombre español. |
| NOMBRE DEL PRODUCTO (INGLÉS) | Traducción opcional. |
| ORGÁNICO | Sí/No, vacío equivale a No. |
| TIPO DE RECETA | Fija/Personalizable y los alias existentes. |
| COSTO ADICIONAL POR UNIDAD | Opcional; conserva la validación actual. |

Se conservan las validaciones de consistencia de datos del producto dentro de un grupo, presentación repetida, SKU existente/duplicado, nombres ambiguos y cantidades. La carga sigue siendo exclusivamente de altas.

## Hoja 2: Materiales de Empaque

| Columna | Uso |
|---|---|
| SKU / NÚMERO DE ARTÍCULO | Relación con la hoja 1, sin distinguir mayúsculas. |
| CÓDIGO MP | Packaging existente y activo; no crea ni actualiza el catálogo. |
| TIPO DE MATERIAL | Clasificación explícita de la fila. |
| GRUPO DE OPCIONES | PackagingGroup existente y activo; vacío para material fijo. |
| PREDETERMINADO | SI/NO obligatorio con grupo; dejar vacío para material fijo. |
| FORMA DE CONSUMO | POR CAJA / POR PALLET; obligatorio para OTRO PALETIZACIÓN. |
| CANTIDAD | Obligatoria y positiva para OTRO PALETIZACIÓN. |

| Tipo | packagingRole requerido | Regla guardada |
|---|---|---|
| INDIVIDUAL | unit | quantityPerUnit = 1 |
| INTERMEDIO | intermediate | Configuración existente unitsPerIntermediatePackage; sin cantidad propia. |
| CAJA | pallet | per_box / 1 |
| ESQUINERO | pallet | per_pallet / 4 |
| TARIMA | pallet | per_pallet / 1 |
| STRETCH | pallet | per_pallet / 93.3 metros |
| OTRO PALETIZACIÓN | pallet | Forma explícita y cantidad > 0, máximo dos decimales y límites del modelo. |

Para tipos conocidos, Forma/Cantidad pueden quedar vacías. Si se proporcionan, deben coincidir exactamente con la regla. Para INTERMEDIO deben quedar vacías. INDIVIDUAL admite cantidad 1 y forma vacía. No se infiere ningún tipo por nombre, código de material o nombre de grupo.

Los defaults de Packaging se conservan. Si un material de paletización tiene defaults configurados y contradicen la regla efectiva, el archivo contiene un error. Nunca se sobrescriben silenciosamente. La asociación guarda quantityBasis y quantityValue; no se altera la matemática del cotizador.

Con grupo, debe existir exactamente un SI por SKU + grupo. Alternativas deben compartir nivel y, para pallet, base/cantidad. Caja y Esquinero permiten alternativas con optionGroupId. Sin grupo, el material es fijo y no debe marcarse SI. No se crean grupos ni se corrigen predeterminados automáticamente.

INTERMEDIO reutiliza ProductVariantIntermediateMaterial y unitsPerIntermediatePackage. No se agregó una columna adicional ni se modificó su cálculo. El modelo existente conserva optionGroup por nombre, mientras Unit/Pallet guardan también optionGroupId.

## Plantilla y preview

La plantilla tiene las dos hojas de datos y **INSTRUCCIONES**. Las hojas de datos vienen vacías, con encabezados destacados, congelados, autofiltro y anchos definidos. Los ejemplos están exclusivamente en INSTRUCCIONES. Deben reemplazarse los códigos de ejemplo por datos reales.

La segunda hoja incluye listas de tipos, SI/NO, POR CAJA/POR PALLET y PackagingGroup activos mediante rango nombrado. El backend valida todo aunque se pegue texto que omita la validación de Excel. Límite: 5 MiB, 5000 variantes y 1000 asociaciones.

El preview muestra productos/variantes y materiales con código, nombre encontrado, tipo explícito, nivel, grupo, predeterminado, regla efectiva y estado/errores. Una Caja con 198 boxesPerPallet muestra **1 por caja · 198 por pallet**, pero guarda per_box / 1.

El resumen incluye productos, variantes, asociaciones Unit/Intermediate/Pallet, errores y advertencias. Los errores identifican hoja y fila; impiden confirmar. El hash relaciona archivo y estado consultado de los catálogos; si cambian, hay que validar nuevamente.

## Arquitectura y transacción

- productImport.service.ts conserva el parser/validador de productos y construye el plan conjunto.
- initialPackagingImport.constant.ts define tipos y encabezados explícitos.
- initialPackagingImport.service.ts adapta las siete columnas al formato interno compartido.
- productPackagingImport.service.ts expone buildPackagingAssociationPlan y writePackagingAssociationPlan, usados por la carga conjunta y por mantenimiento. Existe un solo motor de validación de asociaciones.
- POST /products/bulk-import/preview valida sin escrituras.
- POST /products/bulk-import/confirm requiere previewHash, reconstruye y valida todo con lecturas bloqueadas dentro de una transacción SERIALIZABLE, crea productos/traducciones/variantes, relaciona los SKU del plan con los IDs recién creados y escribe las tres clases de asociación con el mismo objeto transaction.
- Un error de validación impide cualquier create; un error de escritura se propaga al callback y provoca rollback completo. Conflictos de serialización/deadlock exigen nuevo preview.
- POST /products/bulk-import sigue disponible para clientes anteriores: conserva respuesta y también procesa ambas hojas de manera atómica si se proporcionan.

La plantilla anterior de una hoja sigue funcionando. Si falta Materiales de Empaque se crean solamente productos/variantes. Si existe, se valida íntegramente, incluso cuando contiene encabezados sin materiales. El importador separado de materiales conserva sus rutas, su plantilla y el flujo de mantenimiento de variantes existentes.

No se modificaron modelos, catálogo Packaging, cotizador, Quote.breakdown, snapshots ni PDFs históricos.

## Archivos de esta implementación

Backend:
- src/features/product/constants/initialPackagingImport.constant.ts (nuevo)
- src/features/product/services/initialPackagingImport.service.ts (nuevo)
- src/features/product/services/productImport.service.ts
- src/features/product/services/productPackagingImport.service.ts
- src/features/product/controllers/Product.controller.ts
- src/features/product/routes/product.routes.ts
- src/features/product/services/productImport.service.test.ts
- src/features/product/routes/product.routes.test.ts
- src/shared/errors/AppError.ts
- src/shared/middlewares/errorHandler.ts
- src/locales/es/translation.json y en/translation.json
- docs/initial-product-import.md (este documento)

Frontend:
- src/feature/product/api/initialProductImport.api.ts (nuevo)
- src/feature/product/component/initialProductImportPanel.component.tsx (nuevo)
- src/feature/product/api/productPackagingImport.api.ts (contratos compartidos)
- src/feature/product/page/product.page.tsx
- src/shared/api/bulkImport.api.ts (hoja opcional en errores de importación)
- src/shared/i18n/locales/es/translation.json y en/translation.json

## Verificación

Las pruebas usan Excel .xlsx reales en memoria y modelos/transacciones simulados: comprueban reglas, validación antes de escribir, identidad de transaction, enlace de variantes y propagación de fallos para rollback. No importan datos en la base real. La suite HTTP comprueba permisos, preview, confirmación y conflicto de serialización. La suite previa de mantenimiento protege la carga separada.

Resultados: suite completa del backend **83 suites y 1273 pruebas aprobadas**. La última ejecución focalizada aprobó **180 pruebas en 6 suites**. Se agregaron **44 casos** (39 de servicio y 5 HTTP), más la actualización de la prueba de plantilla. Backend build aprobado; frontend typecheck y build aprobados; lint frontend completo y Oxlint de archivos backend afectados aprobados. El backend no tiene script lint propio y el frontend no tiene runner de tests configurado. Los builds no ejecutaron importaciones en la base real.

El build frontend necesitó ejecutarse fuera del sandbox por bloqueo EPERM al iniciar procesos/cargar módulos nativos; terminó correctamente. Vite mantiene la advertencia de chunks mayores de 500 kB.

Para usarlo en desarrollo, actualizar/reiniciar los procesos frontend/backend si no recargan automáticamente. En producción, desplegar ambos builds juntos. No hay pasos de base de datos adicionales para esta mejora.
