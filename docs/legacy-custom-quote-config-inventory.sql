-- Inventario opcional de SOLO LECTURA. Preparado, NO ejecutado por esta limpieza.
-- Ejecutar solamente en la base de datos y esquema correspondientes, después de comprobar
-- la existencia de las tablas/columnas. No es una migración ni un script de retiro.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT 'customQuoteRawMaterialOptions' AS table_name, count(*) AS rows,
       count(*) FILTER (WHERE "isActive") AS active_rows FROM "customQuoteRawMaterialOptions"
UNION ALL
SELECT 'customQuoteIngredientOptions', count(*), count(*) FILTER (WHERE "isActive") FROM "customQuoteIngredientOptions"
UNION ALL
SELECT 'customQuotePresentationOptions', count(*), count(*) FILTER (WHERE "isActive") FROM "customQuotePresentationOptions"
UNION ALL
SELECT 'customQuotePackagingOptions', count(*), count(*) FILTER (WHERE "isActive") FROM "customQuotePackagingOptions";

-- Incluye las FK entrantes y salientes: no se supone que el esquema desplegado sea idéntico al código.
SELECT con.conname, src_ns.nspname AS source_schema, src.relname AS source_table,
       target_ns.nspname AS target_schema, target.relname AS target_table,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
JOIN pg_class target ON target.oid = con.confrelid
JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
WHERE con.contype = 'f' AND (
    src.relname IN ('customQuoteRawMaterialOptions', 'customQuoteIngredientOptions', 'customQuotePresentationOptions', 'customQuotePackagingOptions')
    OR target.relname IN ('customQuoteRawMaterialOptions', 'customQuoteIngredientOptions', 'customQuotePresentationOptions', 'customQuotePackagingOptions')
)
ORDER BY source_schema, source_table, con.conname;

SELECT "configurationOrigin", "snapshotVersion", count(*) AS quotes
FROM "customQuotes" GROUP BY "configurationOrigin", "snapshotVersion";

ROLLBACK;
