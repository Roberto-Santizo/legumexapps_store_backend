-- Complete PostgreSQL baseline for a NEW EMPTY public schema only.
-- Reviewed static SQL; application startup must never generate or apply this schema.
-- Keep the following 202610120001 / 202610120002 migrations unchanged.
-- No commercial records, passwords, permission seeds, or sample data are included.
-- Transactions and migration history are managed by scripts/migrate.cjs.

CREATE TYPE "public"."enum_units_unitType" AS ENUM ('weight', 'volume', 'count');
CREATE TYPE "public"."enum_rawMaterials_ingredientType" AS ENUM ('fruit', 'vegetable', 'pulp', 'other');
CREATE TYPE "public"."enum_packagings_packagingRole" AS ENUM ('unit', 'intermediate', 'pallet');
CREATE TYPE "public"."enum_packagings_defaultQuantityBasis" AS ENUM ('per_box', 'per_pallet');
CREATE TYPE "public"."enum_productVariantPalletMaterials_quantityBasis" AS ENUM ('per_box', 'per_pallet');
CREATE TYPE "public"."enum_destinations_country" AS ENUM ('GT', 'US');
CREATE TYPE "public"."enum_quoteDrafts_status" AS ENUM ('in_progress', 'converted');
CREATE TYPE "public"."enum_customQuotePackagingOptions_quantityBasis" AS ENUM ('per_unit', 'per_pallet', 'per_box');
CREATE TYPE "public"."enum_customQuotes_status" AS ENUM ('new', 'reviewed', 'in_development', 'discarded');
CREATE TYPE "public"."enum_processingCosts_calculationType" AS ENUM ('per_weight', 'percentage');
CREATE TYPE "public"."enum_leads_status" AS ENUM ('new', 'contacted');
CREATE TYPE "public"."enum_juiceRawMaterials_purchaseUnit" AS ENUM ('LIBRA', 'LITRO', 'GRAMO');
CREATE TYPE "public"."enum_juiceCostConstants_singletonKey" AS ENUM ('global');

-- packagingGroups
CREATE TABLE "packagingGroups" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayName" VARCHAR(60) NOT NULL,
    "nameKey" VARCHAR(60) NOT NULL UNIQUE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- categories
CREATE TABLE "categories" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayName" VARCHAR(80) NOT NULL,
    "urlSlug" VARCHAR(80) NOT NULL UNIQUE,
    "fullDescription" TEXT,
    "imageUrl" VARCHAR(500),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- categoryTranslations
CREATE TABLE "categoryTranslations" ("id"   SERIAL ,
    "categoryId" INTEGER NOT NULL REFERENCES "categories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "language" VARCHAR(5) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "fullDescription" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "category_translations_category_id_language" ON "categoryTranslations" ("categoryId", "language");

-- subCategories
CREATE TABLE "subCategories" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" INTEGER NOT NULL REFERENCES "categories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "displayName" VARCHAR(80) NOT NULL,
    "urlSlug" VARCHAR(80) NOT NULL,
    "fullDescription" TEXT,
    "imageUrl" VARCHAR(500),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "sub_categories_category_id_url_slug" ON "subCategories" ("categoryId", "urlSlug");

-- subCategoryTranslations
CREATE TABLE "subCategoryTranslations" ("id"   SERIAL ,
    "subCategoryId" INTEGER NOT NULL REFERENCES "subCategories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "language" VARCHAR(5) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "fullDescription" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "sub_category_translations_sub_category_id_language" ON "subCategoryTranslations" ("subCategoryId", "language");

-- clients
CREATE TABLE "clients" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- products
CREATE TABLE "products" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subCategoryId" INTEGER NOT NULL REFERENCES "subCategories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "clientId" INTEGER NOT NULL REFERENCES "clients" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "displayName" VARCHAR(120) NOT NULL,
    "urlSlug" VARCHAR(120) NOT NULL UNIQUE,
    "isOrganic" BOOLEAN NOT NULL DEFAULT false,
    "isCustomizable" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" VARCHAR(500),
    "additionalCostPerUnit" DECIMAL(10,4),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- productTranslations
CREATE TABLE "productTranslations" ("id"   SERIAL ,
    "productId" INTEGER NOT NULL REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "language" VARCHAR(5) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "product_translations_product_id_language" ON "productTranslations" ("productId", "language");

-- presentations
CREATE TABLE "presentations" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayLabel" VARCHAR(40) NOT NULL,
    "netWeightGrams" DECIMAL(10,2),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- productVariants
CREATE TABLE "productVariants" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "skuCode" VARCHAR(60) NOT NULL,
    "productId" INTEGER NOT NULL REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "presentationId" INTEGER NOT NULL REFERENCES "presentations" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "boxesPerPallet" INTEGER,
    "unitsPerBox" INTEGER,
    "unitsPerIntermediatePackage" INTEGER,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "productVariants_skuCode_unique" ON "productVariants" (lower("skuCode"));

-- units
CREATE TABLE "units" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "unitCode" VARCHAR(10) NOT NULL UNIQUE,
    "displayName" VARCHAR(40) NOT NULL,
    "unitType" "public"."enum_units_unitType" NOT NULL,
    "baseFactor" DECIMAL(16,6) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- rawMaterials
CREATE TABLE "rawMaterials" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" VARCHAR(60) NOT NULL UNIQUE,
    "displayName" VARCHAR(120) NOT NULL,
    "urlSlug" VARCHAR(120) NOT NULL UNIQUE,
    "ingredientType" "public"."enum_rawMaterials_ingredientType" NOT NULL,
    "isOrganicAvailable" BOOLEAN NOT NULL DEFAULT false,
    "isMixable" BOOLEAN NOT NULL DEFAULT true,
    "costPerUnit" DECIMAL(10,4),
    "costUnitId" INTEGER REFERENCES "units" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- productRawMaterials
CREATE TABLE "productRawMaterials" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "productId" INTEGER NOT NULL REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "rawMaterialId" INTEGER NOT NULL REFERENCES "rawMaterials" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "percentage" DECIMAL(5,2),
    "minPercentage" DECIMAL(5,2),
    "maxPercentage" DECIMAL(5,2),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "product_raw_materials_product_id_raw_material_id" ON "productRawMaterials" ("productId", "rawMaterialId");

-- ingredients
CREATE TABLE "ingredients" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" VARCHAR(60) NOT NULL UNIQUE,
    "displayName" VARCHAR(120) NOT NULL,
    "urlSlug" VARCHAR(120) NOT NULL UNIQUE,
    "costPerUnit" DECIMAL(10,4) NOT NULL,
    "costUnitId" INTEGER REFERENCES "units" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- productIngredients
CREATE TABLE "productIngredients" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "productId" INTEGER NOT NULL REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "ingredientId" INTEGER NOT NULL REFERENCES "ingredients" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "grams" DECIMAL(10,3) NOT NULL,
    "referenceNetWeightGrams" DECIMAL(10,2) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "product_ingredients_product_id_ingredient_id" ON "productIngredients" ("productId", "ingredientId");

-- packagings
CREATE TABLE "packagings" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" VARCHAR(60) NOT NULL UNIQUE,
    "displayName" VARCHAR(80) NOT NULL,
    "packagingRole" "public"."enum_packagings_packagingRole" NOT NULL DEFAULT 'unit',
    "unitCost" DECIMAL(10,4),
    "defaultQuantityBasis" "public"."enum_packagings_defaultQuantityBasis",
    "defaultQuantityValue" DECIMAL(10,2),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- productVariantPalletMaterials
CREATE TABLE "productVariantPalletMaterials" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "productVariantId" INTEGER NOT NULL REFERENCES "productVariants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "packagingId" INTEGER NOT NULL REFERENCES "packagings" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "quantityValue" DECIMAL(10,2),
    "quantityBasis" "public"."enum_productVariantPalletMaterials_quantityBasis" NOT NULL DEFAULT 'per_pallet',
    "optionGroupId" INTEGER REFERENCES "packagingGroups" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "optionGroup" VARCHAR(60),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "pvpm_variant_packaging_unique" ON "productVariantPalletMaterials" ("productVariantId", "packagingId");

-- productVariantUnitMaterials
CREATE TABLE "productVariantUnitMaterials" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "productVariantId" INTEGER NOT NULL REFERENCES "productVariants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "packagingId" INTEGER NOT NULL REFERENCES "packagings" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "quantityPerUnit" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "optionGroup" VARCHAR(60),
    "optionGroupId" INTEGER REFERENCES "packagingGroups" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "pvum_variant_packaging_unique" ON "productVariantUnitMaterials" ("productVariantId", "packagingId");

-- productVariantIntermediateMaterials
CREATE TABLE "productVariantIntermediateMaterials" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "productVariantId" INTEGER NOT NULL REFERENCES "productVariants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "packagingId" INTEGER NOT NULL REFERENCES "packagings" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "optionGroup" VARCHAR(60),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "pvim_variant_packaging_unique" ON "productVariantIntermediateMaterials" ("productVariantId", "packagingId");

-- rawMaterialTranslations
CREATE TABLE "rawMaterialTranslations" ("id"   SERIAL ,
    "rawMaterialId" INTEGER NOT NULL REFERENCES "rawMaterials" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "language" VARCHAR(5) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "raw_material_translations_raw_material_id_language" ON "rawMaterialTranslations" ("rawMaterialId", "language");

-- ingredientTranslations
CREATE TABLE "ingredientTranslations" ("id"   SERIAL ,
    "ingredientId" INTEGER NOT NULL REFERENCES "ingredients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "language" VARCHAR(5) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "ingredient_translations_ingredient_id_language" ON "ingredientTranslations" ("ingredientId", "language");

-- destinations
CREATE TABLE "destinations" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayName" VARCHAR(120) NOT NULL,
    "baseCost" DECIMAL(10,4) NOT NULL,
    "country" "public"."enum_destinations_country" NOT NULL DEFAULT 'GT',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- roles
CREATE TABLE "roles" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" VARCHAR(100) UNIQUE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- users
CREATE TABLE "users" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" VARCHAR(100),
    "username" VARCHAR(255) UNIQUE,
    "password" VARCHAR(255),
    "role_id" INTEGER REFERENCES "roles" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "failed_attempts" INTEGER DEFAULT 0,
    "locked_until" TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- permissions
CREATE TABLE "permissions" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" VARCHAR(100) UNIQUE,
    "description" VARCHAR(200),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- role_permissions
CREATE TABLE "role_permissions" ("role_id" INTEGER  REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "permission_id" INTEGER  REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("role_id","permission_id"));

CREATE UNIQUE INDEX "role_permissions_role_id_permission_id" ON "role_permissions" ("role_id", "permission_id");

-- customers
CREATE TABLE "customers" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" VARCHAR(100) NOT NULL,
    "companyName" VARCHAR(100),
    "email" VARCHAR(255) NOT NULL UNIQUE,
    "password" VARCHAR(255) NOT NULL,
    "failed_attempts" INTEGER DEFAULT 0,
    "locked_until" TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- quotes
CREATE TABLE "quotes" ("id"   SERIAL ,
    "customerId" INTEGER NOT NULL REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "productVariantId" INTEGER NOT NULL REFERENCES "productVariants" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "destinationId" INTEGER REFERENCES "destinations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "productDisplayName" VARCHAR(150) NOT NULL,
    "variantLabel" VARCHAR(150),
    "requestedPallets" INTEGER NOT NULL,
    "totalUnits" INTEGER NOT NULL,
    "rawMaterialCost" DECIMAL(12,4) NOT NULL,
    "ingredientCost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "unitPackagingCost" DECIMAL(12,4) NOT NULL,
    "intermediatePackagingCost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "processingCostTotal" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "percentageCostTotal" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "palletMaterialCost" DECIMAL(12,4) NOT NULL,
    "transportCost" DECIMAL(12,4) NOT NULL,
    "adjustmentCost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(12,4) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- quoteDrafts
CREATE TABLE "quoteDrafts" ("id"   SERIAL ,
    "salespersonId" INTEGER NOT NULL REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "draftKey" UUID NOT NULL,
    "productVariantId" INTEGER NOT NULL REFERENCES "productVariants" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "productDisplayName" VARCHAR(150) NOT NULL,
    "variantLabel" VARCHAR(150),
    "requestedPallets" INTEGER NOT NULL,
    "totalCost" DECIMAL(12,4) NOT NULL,
    "input" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,
    "previewCount" INTEGER NOT NULL DEFAULT 1,
    "status" "public"."enum_quoteDrafts_status" NOT NULL DEFAULT 'in_progress',
    "convertedQuoteId" INTEGER REFERENCES "quotes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "quote_drafts_salesperson_id_draft_key" ON "quoteDrafts" ("salespersonId", "draftKey");

-- customQuoteRawMaterialOptions
CREATE TABLE "customQuoteRawMaterialOptions" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subCategoryId" INTEGER NOT NULL REFERENCES "subCategories" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "rawMaterialId" INTEGER NOT NULL REFERENCES "rawMaterials" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "minPercentage" DECIMAL(5,2),
    "maxPercentage" DECIMAL(5,2),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "cqrmo_subcategory_raw_material_unique" ON "customQuoteRawMaterialOptions" ("subCategoryId", "rawMaterialId");

-- customQuoteIngredientOptions
CREATE TABLE "customQuoteIngredientOptions" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ingredientId" INTEGER NOT NULL REFERENCES "ingredients" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "maxGramsPerKg" DECIMAL(10,3),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "cqio_ingredient_unique" ON "customQuoteIngredientOptions" ("ingredientId");

-- customQuotePresentationOptions
CREATE TABLE "customQuotePresentationOptions" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "presentationId" INTEGER NOT NULL REFERENCES "presentations" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "boxesPerPallet" INTEGER NOT NULL,
    "bagsPerBox" INTEGER NOT NULL,
    "unitsPerIntermediatePackage" INTEGER,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "cqpo_presentation_unique" ON "customQuotePresentationOptions" ("presentationId");

-- customQuotePackagingOptions
CREATE TABLE "customQuotePackagingOptions" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "packagingId" INTEGER NOT NULL REFERENCES "packagings" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "quantity" DECIMAL(10,2),
    "quantityBasis" "public"."enum_customQuotePackagingOptions_quantityBasis",
    "optionGroup" VARCHAR(60),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "cqpko_packaging_unique" ON "customQuotePackagingOptions" ("packagingId");

-- customQuotes
CREATE TABLE "customQuotes" ("id"   SERIAL ,
    "configurationOrigin" VARCHAR(30) NOT NULL DEFAULT 'legacy_options',
    "snapshotVersion" SMALLINT NOT NULL DEFAULT 1,
    "sourceProductVariantId" INTEGER REFERENCES "productVariants" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "confirmationKey" UUID,
    "confirmationRequestHash" VARCHAR(64),
    "salespersonId" INTEGER NOT NULL REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "subCategoryId" INTEGER NOT NULL REFERENCES "subCategories" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "presentationId" INTEGER NOT NULL REFERENCES "presentations" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "destinationId" INTEGER REFERENCES "destinations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "productDisplayName" VARCHAR(150) NOT NULL,
    "variantLabel" VARCHAR(150),
    "isOrganic" BOOLEAN NOT NULL DEFAULT false,
    "requestedPallets" INTEGER NOT NULL,
    "totalUnits" INTEGER NOT NULL,
    "boxesPerPallet" INTEGER NOT NULL,
    "bagsPerBox" INTEGER NOT NULL,
    "unitsPerIntermediatePackage" INTEGER,
    "rawMaterialCost" DECIMAL(12,4) NOT NULL,
    "ingredientCost" DECIMAL(12,4) NOT NULL,
    "unitPackagingCost" DECIMAL(12,4) NOT NULL,
    "intermediatePackagingCost" DECIMAL(12,4) NOT NULL,
    "processingCostTotal" DECIMAL(12,4) NOT NULL,
    "palletMaterialCost" DECIMAL(12,4) NOT NULL,
    "percentageCostTotal" DECIMAL(12,4) NOT NULL,
    "transportCost" DECIMAL(12,4) NOT NULL,
    "adjustmentCost" DECIMAL(12,4) NOT NULL,
    "totalCost" DECIMAL(12,4) NOT NULL,
    "configuration" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,
    "status" "public"."enum_customQuotes_status" NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "customQuotes_confirmation_unique" ON "customQuotes" ("salespersonId", "confirmationKey");

-- processingCosts
CREATE TABLE "processingCosts" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayName" VARCHAR(120) NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "calculationType" "public"."enum_processingCosts_calculationType" NOT NULL DEFAULT 'per_weight',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- processingCostTranslations
CREATE TABLE "processingCostTranslations" ("id"   SERIAL ,
    "processingCostId" INTEGER NOT NULL REFERENCES "processingCosts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "language" VARCHAR(5) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "processing_cost_translations_processing_cost_id_language" ON "processingCostTranslations" ("processingCostId", "language");

-- leads
CREATE TABLE "leads" ("id"   SERIAL ,
    "fullName" VARCHAR(150) NOT NULL,
    "companyName" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(30),
    "email" VARCHAR(150) NOT NULL,
    "productLineInterest" VARCHAR(120),
    "notes" TEXT,
    "status" "public"."enum_leads_status" NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- site_images
CREATE TABLE "site_images" ("id"   SERIAL ,
    "slotKey" VARCHAR(30) NOT NULL,
    "imageUrl" VARCHAR(255),
    "altText" VARCHAR(150),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));


-- juiceRawMaterials
CREATE TABLE "juiceRawMaterials" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "purchaseUnit" "public"."enum_juiceRawMaterials_purchaseUnit" NOT NULL,
    "yieldPoundsPerLiter" DECIMAL(14,6) NOT NULL,
    "costPerUnit" DECIMAL(24,12) NOT NULL,
    "costPerLiter" DECIMAL(24,12) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "juiceRawMaterials_code_unique" ON "juiceRawMaterials" (lower("code"));

-- juices
CREATE TABLE "juices" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "urlSlug" VARCHAR(120) NOT NULL,
    "clientId" INTEGER NOT NULL REFERENCES "clients" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "pricePerPound" DECIMAL(24,12) NOT NULL,
    "imageUrl" VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "juices_code_unique" ON "juices" (lower("code"));
CREATE UNIQUE INDEX "juices_url_slug" ON "juices" ("urlSlug");

-- juicePresentations
CREATE TABLE "juicePresentations" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "juiceId" INTEGER NOT NULL REFERENCES "juices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "displayLabel" VARCHAR(120) NOT NULL,
    "mlPerBottle" DECIMAL(14,3) NOT NULL,
    "bottlesPerCase" INTEGER NOT NULL,
    "casesPerPallet" INTEGER NOT NULL,
    "boxUnitCost" DECIMAL(24,12) NOT NULL,
    "stickerUnitCost" DECIMAL(24,12) NOT NULL,
    "stickerQuantityPerCase" DECIMAL(14,6) NOT NULL,
    "secondStickerUnitCost" DECIMAL(24,12) NOT NULL,
    "secondStickerQuantityPerCase" DECIMAL(14,6) NOT NULL,
    "bottleUnitCost" DECIMAL(24,12) NOT NULL,
    "capUnitCost" DECIMAL(24,12) NOT NULL,
    "marginPerCase" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "juice_presentations_juice_id_display_label" ON "juicePresentations" ("juiceId", "displayLabel");

-- juiceMixes
CREATE TABLE "juiceMixes" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "juiceId" INTEGER NOT NULL REFERENCES "juices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "rawMaterialId" INTEGER NOT NULL REFERENCES "juiceRawMaterials" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "percentage" DECIMAL(14,6) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "juice_mixes_juice_id_raw_material_id" ON "juiceMixes" ("juiceId", "rawMaterialId");

-- juiceSpiceMaterials
CREATE TABLE "juiceSpiceMaterials" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "costPerGram" DECIMAL(24,12) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "juiceSpiceMaterials_code_unique" ON "juiceSpiceMaterials" (lower("code"));

-- juiceSpices
CREATE TABLE "juiceSpices" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "juiceId" INTEGER NOT NULL REFERENCES "juices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "spiceMaterialId" INTEGER NOT NULL REFERENCES "juiceSpiceMaterials" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "gramsPerLiter" DECIMAL(14,6) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "juice_spices_juice_id_spice_material_id" ON "juiceSpices" ("juiceId", "spiceMaterialId");

-- juiceCostConstants
CREATE TABLE "juiceCostConstants" ("id"   SERIAL ,
    "singletonKey" "public"."enum_juiceCostConstants_singletonKey" NOT NULL DEFAULT 'global',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "directLaborPerPound" DECIMAL(14,4) NOT NULL,
    "indirectLaborPerPound" DECIMAL(14,4) NOT NULL,
    "financialPerPound" DECIMAL(14,4) NOT NULL,
    "fixedPerPound" DECIMAL(14,4) NOT NULL,
    "electricityPerPound" DECIMAL(14,4) NOT NULL,
    "cleaningPerPound" DECIMAL(14,4) NOT NULL,
    "laboratoryPerPound" DECIMAL(14,4) NOT NULL,
    "hppPerPound" DECIMAL(14,4) NOT NULL,
    "palletizingPerContainer" DECIMAL(14,4) NOT NULL,
    "localCustomsPerContainer" DECIMAL(14,4) NOT NULL,
    "miamiCustomsPerContainer" DECIMAL(14,4) NOT NULL,
    "freightPerContainer" DECIMAL(14,4) NOT NULL,
    "inOutPerContainer" DECIMAL(14,4) NOT NULL,
    "accesorialPerContainer" DECIMAL(14,4) NOT NULL,
    "storagePerContainer" DECIMAL(14,4) NOT NULL,
    "logisticMovementPerContainer" DECIMAL(14,4) NOT NULL,
    "unexpectedRate" DECIMAL(14,6) NOT NULL,
    "tariffRate" DECIMAL(14,6) NOT NULL,
    "portFeeRate" DECIMAL(14,6) NOT NULL,
    "salesmanCommissionRate" DECIMAL(14,6) NOT NULL,
    "distributorCommissionRate" DECIMAL(14,6) NOT NULL,
    "palletsPerContainer" INTEGER NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "juice_cost_constants_singleton_key" ON "juiceCostConstants" ("singletonKey");

-- juiceClientConstantOverrides
CREATE TABLE "juiceClientConstantOverrides" ("id"   SERIAL ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clientId" INTEGER NOT NULL REFERENCES "clients" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    "directLaborPerPound" DECIMAL(14,4),
    "indirectLaborPerPound" DECIMAL(14,4),
    "financialPerPound" DECIMAL(14,4),
    "fixedPerPound" DECIMAL(14,4),
    "electricityPerPound" DECIMAL(14,4),
    "cleaningPerPound" DECIMAL(14,4),
    "laboratoryPerPound" DECIMAL(14,4),
    "hppPerPound" DECIMAL(14,4),
    "palletizingPerContainer" DECIMAL(14,4),
    "localCustomsPerContainer" DECIMAL(14,4),
    "miamiCustomsPerContainer" DECIMAL(14,4),
    "freightPerContainer" DECIMAL(14,4),
    "inOutPerContainer" DECIMAL(14,4),
    "accesorialPerContainer" DECIMAL(14,4),
    "storagePerContainer" DECIMAL(14,4),
    "logisticMovementPerContainer" DECIMAL(14,4),
    "unexpectedRate" DECIMAL(14,6),
    "tariffRate" DECIMAL(14,6),
    "portFeeRate" DECIMAL(14,6),
    "salesmanCommissionRate" DECIMAL(14,6),
    "distributorCommissionRate" DECIMAL(14,6),
    "palletsPerContainer" INTEGER,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "juice_client_constant_overrides_client_id" ON "juiceClientConstantOverrides" ("clientId");

-- SQL-history constraints not expressible by the current Sequelize decorators.
ALTER TABLE "packagings" ADD CONSTRAINT "packagings_consumption_defaults_check" CHECK (
    ("defaultQuantityBasis" IS NULL AND "defaultQuantityValue" IS NULL)
    OR ("packagingRole" = 'pallet' AND "defaultQuantityBasis" IS NOT NULL
        AND "defaultQuantityValue" IS NOT NULL AND "defaultQuantityValue" > 0
        AND "defaultQuantityValue" <= 99999999.99)
);
CREATE INDEX "customQuotes_source_variant_idx" ON "customQuotes" ("sourceProductVariantId");

ALTER TABLE "site_images" ADD CONSTRAINT "site_images_slotkey_unique" UNIQUE ("slotKey");
