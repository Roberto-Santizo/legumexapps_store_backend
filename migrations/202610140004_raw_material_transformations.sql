-- Transformación de Materia Prima: origen sin procesar -> registro procesado del catálogo
-- rawMaterials (que sigue siendo la única fuente de costos del cotizador) + desglose de costos.
-- Solo crea objetos nuevos; no modifica tablas existentes ni datos.

-- unprocessedRawMaterials
CREATE TYPE "public"."enum_unprocessedRawMaterials_costCurrency" AS ENUM ('GTQ', 'USD');
CREATE TABLE "unprocessedRawMaterials" ("id"   SERIAL ,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "costPerPound" DECIMAL(24,12) NOT NULL,
    "costCurrency" "public"."enum_unprocessedRawMaterials_costCurrency" NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "unprocessedRawMaterials_code_unique" ON "unprocessedRawMaterials" (lower("code"));
ALTER TABLE "unprocessedRawMaterials" ADD CONSTRAINT "unprocessedRawMaterials_values_check"
    CHECK (btrim("code") <> '' AND btrim("displayName") <> '' AND "costPerPound" >= 0);

-- rawMaterialTransformations
CREATE TYPE "public"."enum_rawMaterialTransformations_freightCurrency" AS ENUM ('GTQ', 'USD');
CREATE TABLE "rawMaterialTransformations" ("id"   SERIAL ,
    "unprocessedRawMaterialId" INTEGER NOT NULL REFERENCES "unprocessedRawMaterials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "processedRawMaterialId" INTEGER NOT NULL UNIQUE REFERENCES "rawMaterials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "freightPerPound" DECIMAL(24,12) NOT NULL,
    "freightCurrency" "public"."enum_rawMaterialTransformations_freightCurrency" NOT NULL,
    "yieldPercentage" DECIMAL(7,4) NOT NULL,
    "exchangeRate" DECIMAL(14,6) NOT NULL,
    "inputCostUsdPerPound" DECIMAL(24,12) NOT NULL,
    "freightUsdPerPound" DECIMAL(24,12) NOT NULL,
    "rawMaterialCostUsd" DECIMAL(24,12) NOT NULL,
    "directLaborCostUsd" DECIMAL(24,12) NOT NULL,
    "packagingCostUsd" DECIMAL(24,12) NOT NULL,
    "otherCostUsd" DECIMAL(24,12) NOT NULL,
    "processedCostUsd" DECIMAL(24,12) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));
CREATE INDEX "rawMaterialTransformations_unprocessed_idx" ON "rawMaterialTransformations" ("unprocessedRawMaterialId");
ALTER TABLE "rawMaterialTransformations" ADD CONSTRAINT "rawMaterialTransformations_values_check"
    CHECK ("yieldPercentage" > 0 AND "yieldPercentage" <= 100 AND "exchangeRate" > 0 AND "freightPerPound" >= 0
        AND "inputCostUsdPerPound" >= 0 AND "freightUsdPerPound" >= 0 AND "rawMaterialCostUsd" >= 0
        AND "directLaborCostUsd" >= 0 AND "packagingCostUsd" >= 0 AND "otherCostUsd" >= 0 AND "processedCostUsd" >= 0);

-- rawMaterialTransformationCosts
CREATE TYPE "public"."enum_rawMaterialTransformationCosts_category" AS ENUM ('direct_labor', 'packaging', 'other');
CREATE TYPE "public"."enum_rawMaterialTransformationCosts_currency" AS ENUM ('GTQ', 'USD');
CREATE TYPE "public"."enum_rawMaterialTransformationCosts_costBasis" AS ENUM ('per_processed_pound', 'per_input_pound', 'per_unit', 'per_batch');
CREATE TABLE "rawMaterialTransformationCosts" ("id"   SERIAL ,
    "transformationId" INTEGER NOT NULL REFERENCES "rawMaterialTransformations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "category" "public"."enum_rawMaterialTransformationCosts_category" NOT NULL,
    "conceptName" VARCHAR(120) NOT NULL,
    "amount" DECIMAL(24,12) NOT NULL,
    "currency" "public"."enum_rawMaterialTransformationCosts_currency" NOT NULL,
    "costBasis" "public"."enum_rawMaterialTransformationCosts_costBasis" NOT NULL,
    "poundsPerUnit" DECIMAL(14,4),
    "costUsdPerProcessedPound" DECIMAL(24,12) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));
CREATE INDEX "rawMaterialTransformationCosts_transformation_category_idx" ON "rawMaterialTransformationCosts" ("transformationId", "category");
ALTER TABLE "rawMaterialTransformationCosts" ADD CONSTRAINT "rawMaterialTransformationCosts_values_check"
    CHECK (btrim("conceptName") <> '' AND "amount" >= 0 AND "costUsdPerProcessedPound" >= 0 AND "sortOrder" >= 0
        AND (("costBasis" IN ('per_unit', 'per_batch') AND "poundsPerUnit" IS NOT NULL AND "poundsPerUnit" > 0)
            OR ("costBasis" IN ('per_processed_pound', 'per_input_pound') AND "poundsPerUnit" IS NULL)));
