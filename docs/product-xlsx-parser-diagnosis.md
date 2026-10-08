# Diagnóstico inicial de lectura XLSX — 2026-10-06

Este documento registra la investigación inicial, anterior a recibir el XLSX original. El archivo ya fue localizado y la causa se confirmó; ver el [diagnóstico actualizado y fallback](xlsx-fallback-imports.md).

## Resultado y límites

No se reprodujo el fallo con la plantilla actual sin editar. Se probó el router real de Products con `GET /api/products/bulk-import/template` seguido de `POST /api/products/bulk-import/preview`, usando Express, autenticación, Multer, controller, generación y lectura reales. Solo los modelos/catálogos y la conexión de base de datos se sustituyen en el entorno de pruebas; esto no es una prueba contra el servidor desplegado.

El adjunto recibido contiene exclusivamente el reporte de texto. No contiene el XLSX original que falló. Por tanto, **la causa raíz del incidente original sigue sin determinarse**. No se cambió la generación de plantilla ni se presenta la protección de errores como una solución de esa causa pendiente.

## Evidencia anterior a los cambios de producción

- Las 77 pruebas existentes de `productImport.service.test.ts` pasaron.
- La plantilla descargada por el endpoint real se guardó a disco y se leyó como Buffer con `loadWorkbookFromBuffer`.
- Se detectaron las tres hojas: Productos y Variantes, Materiales de Empaque e INSTRUCCIONES.
- Al subirla al preview, el servicio recibió un Buffer idéntico byte por byte al descargado. El endpoint devolvió 422 por falta de filas de datos, después de abrir correctamente el workbook.
- Se verificaron las entradas ZIP `[Content_Types].xml`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels` y las tres hojas XML.
- Con una copia de esa plantilla cuyo `xl/workbook.xml` se vació deliberadamente, se reprodujo exactamente `TypeError: Cannot read properties of undefined (reading 'sheets')` en `xlsx.js:323`, también por el endpoint real, antes de modificar producción. Este archivo sintético conserva un ZIP válido, firma PK y Buffer no vacío.
- `node scripts/diagnose-exceljs-parser.cjs` permite reproducir directamente la excepción original sin tocar `node_modules`.

## Qué significa `.sheets` de undefined

`package.json` declara ExcelJS `^4.4.0`; el lock y el paquete instalado corresponden a 4.4.0. La API local declara `workbook.xlsx.load(buffer, options?)`.

En `node_modules/exceljs/lib/xlsx/xlsx.js`, el caso `xl/workbook.xml` llama a `parseWorkbook(stream)` y después accede a `workbook.sheets`. `WorkbookXform` construye el modelo al cerrar el nodo `workbook`. Un XML vacío no produce ese modelo; por eso `parseWorkbook` devuelve undefined y el acceso falla. Esto explica el mecanismo exacto de la excepción reproducida, pero no demuestra que el archivo original tuviera el mismo defecto. Para comprobarlo hace falta ese archivo.

## Transporte y entrada

Step 1 selecciona `event.target.files?.[0]`, conserva ese File y lo pasa a `previewInitialProductImportAPI`. El helper `postBulkImportPreviewFile` usa `FormData.append("file", file)` y llama a Axios sin configurar manualmente Content-Type. Multer usa `memoryStorage()` y `single("file")`. El controller pasa `req.file.buffer`, no req.file, Blob, nombre ni objeto serializado.

Recipes usa el mismo campo y un File real mediante `postBulkImportFile`. Ese helper anterior sí configura un Content-Type multipart explícito; Step 1 utiliza el helper de preview, que no lo hace. No se modificó frontend.

La regresión HTTP demuestra que el transporte conserva los bytes de la plantilla probada. No hay evidencia disponible sobre el Buffer de la solicitud original fallida.

## Protección añadida

- Antes de ExcelJS: Buffer real, contenido no vacío, máximo 5 MiB y firma ZIP de archivo local `PK\x03\x04`.
- En preview/confirm: existencia de req.file, extensión .xlsx, MIME permitido y tamaño de Multer igual al largo del Buffer. Se aceptan MIME genéricos/vacíos para evitar depender exclusivamente del navegador; la firma y el parser siguen siendo obligatorios.
- Los fallos de ZIP/XML/ExcelJS y workbooks sin hojas legibles se convierten en `ExcelImportParseError`, un AppError 422 con causa original.
- Ante un fallo de parseo del preview, el controller registra únicamente existencia del archivo/Buffer, tipo Buffer, largo, originalname, mimetype y size. El middleware conserva la causa en el log interno y responde solo con el mensaje traducido. No registra contenido completo del archivo.
- Mensajes ES/EN: archivo inválido y archivo que no se pudo leer.

No se alteraron Products, Variants, Packaging, cantidades, grupos, defaults, cotizaciones ni la transacción de confirmación. Tampoco se modificó ExcelJS ni la plantilla.

## Regresiones

Una y tres hojas; plantilla descargada → disco → lector → multipart; plantilla rellenada en fila 2 con variante y CAJA → guardado → preview; Buffer vacío o de tipo incorrecto; exceso de tamaño; archivo no XLSX; ZIP roto con firma PK; ZIP con workbook.xml vacío que reproduce exactamente el TypeError; archivos con entradas requeridas ausentes; multipart sin file; MIME genérico; extensión/MIME incompatibles; metadatos de tamaño inconsistentes; error 422 sin stack/cause en la respuesta y causa conservada internamente.

La edición y guardado de la plantilla se simulan con ExcelJS. No se verificó una edición manual en Microsoft Excel o LibreOffice.

## Siguiente comprobación necesaria

Inspeccionar el XLSX original fallido desde disco y con el mismo preview, revisar su workbook.xml y relaciones, y comparar sus bytes antes/después del upload. No hay evidencia de que sea necesario regenerar la plantilla: la actual se puede descargar y volver a leer. Volver a descargarla sirve como prueba comparativa; hay que conservar el archivo fallido para completar el diagnóstico.

## Archivos modificados en esta intervención

- `src/shared/utils/excelImport.util.ts`: validación binaria y conversión de errores de lectura.
- `src/shared/errors/AppError.ts`: error de parseo con causa interna.
- `src/shared/middlewares/errorHandler.ts`: log interno de la causa, respuesta 422 traducida.
- `src/features/product/controllers/Product.controller.ts`: validación de upload y log de metadatos cuando falla el parseo del preview.
- `src/locales/es/translation.json` y `src/locales/en/translation.json`: mensajes de archivo inválido/ilegible.
- `src/shared/utils/excelImport.util.test.ts`: nuevas regresiones del lector.
- `src/shared/middlewares/errorHandler.test.ts`: causa interna y respuesta segura.
- `src/features/product/routes/product.routes.test.ts`: multipart, Buffer y metadatos; fixtures XLSX reales.
- `src/features/product/services/productImport.service.test.ts`: descarga/lectura/upload reales y plantilla rellenada, con catálogos simulados.
- `scripts/diagnose-exceljs-parser.cjs`: reproducción aislada de la excepción de ExcelJS 4.4.0.
- Este documento.

El workspace ya contenía cambios del usuario; esta lista identifica únicamente los archivos tocados por esta intervención, no atribuye los demás cambios existentes.

## Verificación final

- Pruebas relevantes: 4 suites, 125 pruebas aprobadas.
- Suite completa con cobertura: 84 suites, 1303 pruebas aprobadas (`node node_modules/jest/bin/jest.js --runInBand`).
- Después de agregar el log de metadatos se repitió la integración descarga/preview, aprobada.
- Typecheck: `npx tsc --noEmit`, aprobado, también tras el último cambio del controller.
- Build: `npm run build`, aprobado.
- `git diff --check` en los archivos tocados y `node --check scripts/diagnose-exceljs-parser.cjs`: aprobados.
- Backend no tiene script ni configuración de lint/formatter; no se instaló una herramienta nueva.
- Frontend no se modificó; no se ejecutaron checks del frontend.
- El primer intento de suite completa con npm perdió el argumento runInBand y falló con `spawn EPERM`. Se reintentó con el ejecutable de Jest directamente y permisos ampliados; la suite completa terminó correctamente.
