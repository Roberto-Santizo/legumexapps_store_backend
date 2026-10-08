# Lectura XLSX con fallback — 2026-10-06

## Causa exacta del archivo real

Se localizó en Descargas y se incorporó como fixture sin modificar sus bytes:
`carga_masiva_PRODUCTOS_VARIANTES_EMPAQUES_exceljs_FINAL.xlsx`.

- Tamaño: 20.007 bytes; Buffer real y firma ZIP `504b0304`.
- SHA-256: `631d969407e5fe928518df94bef4d08d29a38af45d0469374473ba8b03be01d7`.
- Las partes requeridas existen y contienen XML bien formado.
- `xl/workbook.xml` usa `x:workbook`, con el namespace estándar de SpreadsheetML. Las hojas usan `x:worksheet` en el mismo namespace.
- ExcelJS instalado: 4.4.0. `WorkbookXform.parseClose` compara el nombre literal `workbook`, en lugar del nombre local y el URI. Al cerrar `x:workbook` no construye el modelo. `XLSX.load`, línea 323, intenta leer `workbook.sheets` sobre undefined.
- `[Content_Types].xml` declara el tipo del workbook mediante un `Default` para `xml`; las otras partes tienen `Override`. El fallback resuelve ambos mecanismos con precedencia de Override. No exige que el workbook tenga un Override específico.

No es una pérdida de bytes en multipart, un Buffer incorrecto ni un archivo ZIP corrupto. Es una incompatibilidad de interpretación de namespaces en ExcelJS. Se reprodujo el TypeError exacto con el archivo real y se verificó su lectura independiente con openpyxl.

## Parsers y dependencia

ExcelJS continúa como parser principal. Solo si falla su lectura, o no entrega hojas legibles, se intenta un lector OOXML de datos. Este lector usa `saxes` 5.0.1, ya instalado como dependencia transitiva de ExcelJS, y `node:zlib` para la descompresión acotada. Se declaró saxes directamente en package.json/lock, sin cambiar su versión instalada ni agregar otro árbol de dependencias.

No existía SheetJS/xlsx en el proyecto. Reutilizar el lector XML existente evita otro motor de planillas y permite ignorar las partes visuales incompatibles, conservando los datos y las fórmulas. Saxes soporta namespaces y comprueba XML bien formado; el fallback resuelve las relaciones y partes de SpreadsheetML. Referencias: [documentación de saxes](https://github.com/lddubeau/saxes), [Namespaces in XML](https://www.w3.org/TR/xml-names/).

Saxes es una dependencia ya utilizada por ExcelJS y su repositorio está archivado. No se introdujo una librería nueva con una afirmación de mantenimiento activo; mantener el lector OOXML adicional es responsabilidad de este proyecto.

## Abstracción y compatibilidad

`parsedWorkbook.ts` define ParsedWorkbook, ParsedWorksheet, ParsedRow y ParsedCell: el contrato estructural de lectura que utilizan los importadores. También define ParsedWorkbookData/ParsedSheetData para los valores recuperados del ZIP. Los servicios no seleccionan parsers ni inspeccionan sus estructuras internas.

Un único adaptador materializa el resultado del fallback como workbook de datos. `loadWorkbookFromBuffer` conserva la API editable de ExcelJS para los callers existentes que rellenan/guardan plantillas; los servicios de importación consumen el contrato Parsed*. La generación de plantillas sigue intacta.

Se recuperan nombres, posiciones y filas físicas, strings compartidos/inline, rich text concatenado, números, booleanos, celdas vacías, errores y fechas ISO explícitas. Se preservan espacios y posiciones; trim/normalización permanecen en las validaciones existentes. Toda fórmula, incluso seguidores de fórmulas compartidas sin texto, conserva un marcador de fórmula; no se ejecuta ni se sustituye por el resultado cacheado.

## Resultado del archivo y del endpoint

El archivo real recupera:

| Hoja | Filas físicas | Columnas | Celdas no vacías |
| --- | ---: | ---: | ---: |
| Productos y Variantes | 76 | 14 | 989 |
| Materiales de Empaque | 1001 | 7 | 916 |
| INSTRUCCIONES | 22 | 1 | 22 |

Los checksums de todas las 1.927 celdas no vacías coinciden con un lector independiente openpyxl. El JSON de referencia contiene únicamente nombres, conteos y hashes, no datos de celdas.

Se envió este mismo Buffer a `POST /api/products/bulk-import/preview` mediante Supertest, con el router, autenticación, Multer, controller, loader y servicio reales. Respondió **200 con preview y errores de datos/catálogos**, sin el mensaje de archivo ilegible. Los catálogos y la conexión de base de datos se simulan en esta integración. No se afirma haber probado un servidor desplegado ni catálogos de producción, y no se confirmó ninguna importación.

La plantilla oficial sigue abriéndose con el parser principal. También se prueba una plantilla oficial rellenada, guardada y reserializada con namespaces explícitos: el preview reconoce la variante y CAJA con per_box/1.

## Seguridad y errores

Antes de cualquier parser se validan Buffer, longitud, máximo de 5 MiB y firma ZIP; el controller conserva extensión, MIME y tamaño de Multer. La lectura del archivo no extrae nada al filesystem.

El lector ZIP valida directorio, nombres y headers locales, CRC y tamaños. Antes de inflar limita 2.048 entradas, 16 MiB por entrada y 48 MiB totales. Además, zlib limita la salida real al tamaño declarado: mentir en el directorio no evita el límite. Se rechazan entradas cifradas, rutas inseguras, duplicadas, métodos no soportados y archivos corruptos.

El fallback limita 100 hojas, 100.000 filas físicas por hoja, 16.384 columnas, un millón de celdas totales y un MiB de texto por celda. También limita profundidad/nodos/atributos XML, rechaza DTD y relaciones externas de datos y exige XML completo. Los límites de negocio existentes (por ejemplo, 5.000 productos y 1.000 materiales) se siguen aplicando después: estos límites técnicos no los sustituyen.

Si ExcelJS falla pero el fallback funciona, no hay error al usuario. Si ambos fallan, se devuelve AppError 422 traducido, conservando ambas causas internamente. Si el ZIP ya es ilegible/inseguro, se rechaza antes de intentar parsers. En desarrollo se registra un mensaje breve al recuperar con fallback y metadatos/resumen de errores cuando falla; en producción no se imprimen stacks de errores esperados ni contenido del archivo.

## Consumidores revisados

Products/Variants, Recipes (productRawMaterial), Product Ingredients, Product Packaging Associations, parser inicial de empaques, Packaging, Raw Materials, Ingredients, Presentations, Clients y Juices. Solo se sustituyeron anotaciones de tipos de lectura por Parsed*. No se cambiaron validaciones, cantidades CAJA/ESQUINERO/TARIMA/STRETCH, grupos, defaults, transacciones ni cotizaciones.

## Archivos de esta intervención

- `package.json`, `package-lock.json`: declaración directa de la versión existente de saxes.
- `src/shared/utils/excelImport.util.ts`: estrategia principal/fallback y adaptación común.
- `src/shared/utils/parsedWorkbook.ts`: contrato de lectura normalizado.
- `src/shared/utils/xlsxArchive.util.ts`: ZIP acotado e integridad.
- `src/shared/utils/xlsxDataParser.util.ts`: lector OOXML namespace-aware de datos.
- `src/shared/errors/AppError.ts`: conservación de ambas causas.
- `src/shared/middlewares/errorHandler.ts` y `src/features/product/controllers/Product.controller.ts`: logs esperados solo en desarrollo.
- Servicios con anotaciones Parsed*, generación y reglas intactas:
  `src/features/product/services/productImport.service.ts`,
  `src/features/product/services/productRawMaterialImport.service.ts`,
  `src/features/product/services/productIngredientImport.service.ts`,
  `src/features/product/services/productPackagingImport.service.ts`,
  `src/features/product/services/initialPackagingImport.service.ts`,
  `src/features/packaging/services/packaging.service.ts`,
  `src/features/rawMaterial/services/rawMaterial.service.ts`,
  `src/features/ingredient/services/ingredient.service.ts`,
  `src/features/presentation/services/presentation.service.ts`,
  `src/features/client/services/clientImport.service.ts`,
  `src/features/juice/services/juiceImport.service.ts`.
- Tests de excelImport, xlsxArchive, errorHandler, Products, Recipes, Product Ingredients, Product Packaging y Clients.
- `src/shared/test-utils/xlsxCompatibility.fixture.ts` y `fixtures/`: workbook real, fixture independiente openpyxl y hashes de referencia.
- `scripts/build-xlsx-compatibility-fixture.py`, `scripts/build-xlsx-reference.py`, `scripts/inspect-xlsx-compatibility.cjs`: reproducción y diagnóstico; Python/openpyxl son herramientas de desarrollo, no requisitos de ejecución ni de tests Node.
- Este informe y enlace de actualización en el diagnóstico inicial.

El workspace ya tenía cambios del usuario; los diffs contra HEAD incluyen trabajo anterior que esta intervención no modifica ni atribuye.

## Pruebas y límites restantes

Las regresiones cubren plantilla principal, una/múltiples hojas, archivo real, fixture independiente, fallback recuperable, ambos parsers fallando, Buffer vacío, texto renombrado, ZIP inválido, headers y nombres/legacy, materiales, strings/números/booleans/blanks/rich text, fórmulas, límites, CRC/rutas/cifrado, XML truncado, relaciones externas y consumidores Recipes/Ingredients/Packaging/Clients. La suite completa verifica también los demás importadores.

El fallback es un lector de datos OOXML, no un motor de Excel ni un preservador de estilos. Se soportan ZIP clásico STORE/DEFLATE; ZIP64, archivos cifrados y .xls binario quedan fuera. No interpreta formatos de fecha basados en estilos; actualmente no hay columnas de fecha de importación que requieran esa conversión. No evalúa fórmulas, carga macros ni consulta relaciones externas. No se probó una edición manual en Excel/Google Sheets: se verifican archivos y serializadores reales mediante fixtures.

## Verificación final

- Suite completa con cobertura: **85 suites, 1.335 pruebas aprobadas**, incluyendo las 32 regresiones nuevas y los consumidores restantes. Comando: `node node_modules/jest/bin/jest.js --runInBand`.
- Typecheck: `npx tsc --noEmit`, aprobado.
- Build: `npm run build`, aprobado.
- Whitespace: `git diff --check` en archivos modificados, aprobado; sintaxis del script de diagnóstico `node --check`, aprobada.
- Lint/formatter backend: no existe script/configuración en el proyecto; no se añadió otra herramienta.
- Frontend no se modificó, por lo que no se ejecutaron tests/typecheck/Oxlint/build frontend.
- No se necesita volver a descargar ni regenerar la plantilla para que el archivo real pase la capa de lectura.
