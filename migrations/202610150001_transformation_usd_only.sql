-- Transformación de Materia Prima: todos los importes se ingresan en USD. Se eliminan las monedas y
-- el tipo de cambio. Antes de borrarlos, los importes que estuvieran en quetzales se convierten a USD
-- con el tipo de cambio guardado en su transformación, para que ningún valor cambie de significado.
-- Los resultados ya estaban en USD y no se modifican.

UPDATE "rawMaterialTransformationCosts" AS c
    SET "amount" = c."amount" / t."exchangeRate", "currency" = 'USD'
    FROM "rawMaterialTransformations" AS t
    WHERE t."id" = c."transformationId" AND c."currency" = 'GTQ';

UPDATE "rawMaterialTransformations"
    SET "freightPerPound" = "freightPerPound" / "exchangeRate", "freightCurrency" = 'USD'
    WHERE "freightCurrency" = 'GTQ';

-- Un origen sin procesar siempre tiene al menos una transformación (los huérfanos se eliminan);
-- se usa el tipo de cambio de la más antigua.
UPDATE "unprocessedRawMaterials" AS u
    SET "costPerPound" = u."costPerPound" / (
            SELECT t."exchangeRate" FROM "rawMaterialTransformations" AS t
            WHERE t."unprocessedRawMaterialId" = u."id" ORDER BY t."id" LIMIT 1),
        "costCurrency" = 'USD'
    WHERE u."costCurrency" = 'GTQ'
        AND EXISTS (SELECT 1 FROM "rawMaterialTransformations" AS t WHERE t."unprocessedRawMaterialId" = u."id");

ALTER TABLE "rawMaterialTransformations" DROP CONSTRAINT "rawMaterialTransformations_values_check";
ALTER TABLE "rawMaterialTransformationCosts" DROP COLUMN "currency";
ALTER TABLE "rawMaterialTransformations" DROP COLUMN "freightCurrency", DROP COLUMN "exchangeRate";
ALTER TABLE "unprocessedRawMaterials" DROP COLUMN "costCurrency";
DROP TYPE "public"."enum_rawMaterialTransformationCosts_currency";
DROP TYPE "public"."enum_rawMaterialTransformations_freightCurrency";
DROP TYPE "public"."enum_unprocessedRawMaterials_costCurrency";
ALTER TABLE "rawMaterialTransformations" ADD CONSTRAINT "rawMaterialTransformations_values_check"
    CHECK ("yieldPercentage" > 0 AND "yieldPercentage" <= 100 AND "freightPerPound" >= 0
        AND "inputCostUsdPerPound" >= 0 AND "freightUsdPerPound" >= 0 AND "rawMaterialCostUsd" >= 0
        AND "directLaborCostUsd" >= 0 AND "packagingCostUsd" >= 0 AND "otherCostUsd" >= 0 AND "processedCostUsd" >= 0);
