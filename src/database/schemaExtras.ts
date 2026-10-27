/** Current PostgreSQL-only complements. Tables, columns, keys and indexes belong to models.
 * No history, pending steps or automatic upgrades. Install only on a verified empty schema.
 * Each feature declares its own complements in features/<feature>/models/<feature>.dbExtras.ts;
 * this file only aggregates them in installation order (functions before the triggers that use them).
 */
import { packagingChecks, packagingFunctions, packagingTriggers } from "../features/packaging/models/packaging.dbExtras";
import { rawMaterialTransformationChecks } from "../features/rawMaterialTransformation/models/rawMaterialTransformation.dbExtras";
import { presentationChecks } from "../features/presentation/models/presentation.dbExtras";
import { juiceChecks } from "../features/juice/models/juice.dbExtras";
import { genericPackagingChecks, genericPackagingFunctions, genericPackagingTriggers } from "../features/genericPackaging/models/genericPackaging.dbExtras";
import { productTriggers } from "../features/product/models/product.dbExtras";

export const schemaChecks = [
    ...packagingChecks,
    ...rawMaterialTransformationChecks,
    ...presentationChecks,
    ...juiceChecks,
    ...genericPackagingChecks,
] as const;
export const schemaFunctions = [
    ...packagingFunctions,
    ...genericPackagingFunctions,
] as const;
export const schemaTriggers = [
    ...productTriggers,
    ...packagingTriggers,
    ...genericPackagingTriggers,
] as const;
