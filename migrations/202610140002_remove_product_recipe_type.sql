ALTER TABLE public."products" DROP COLUMN IF EXISTS "isCustomizable";
ALTER TABLE public."productRawMaterials" DROP COLUMN IF EXISTS "minPercentage", DROP COLUMN IF EXISTS "maxPercentage";
