# Catalog-based customizable quotes

## Domain and boundaries

Customize is a quotation request, never a Product/ProductVariant/SKU creation operation.
Ready-made keeps its existing endpoint, snapshot and calculation semantics, including its
historical percentage tolerance. New requests use `customQuotes`, origin `catalog_variant`,
snapshot version 2. Legacy rows default to `legacy_options`, version 1.

The UI exposes Category → Subcategory → material type and Organic/Conventional → exact mix →
configuration → packaging/pallets → server preview → review → confirmation → PDF/email.
The previous `/solicitud/a-la-medida` route now opens this flow. The main selection has only
Ready-made and Customize. Legacy creation UI/API wrappers have been removed; backend legacy
contracts, administrative configuration, statuses, permissions and historical readers remain.

## Catalog discovery

`GET /api/custom-quotes/configurations` requires salesperson authentication.
RawMaterial options are deduplicated through active ProductRawMaterial associations on active
Products in an active SubCategory/Category. Product.isCustomizable and Product.isOrganic do
not restrict configuration discovery. RawMaterial.isOrganic is authoritative for composition.
Only active, mixable RawMaterials with a nonnegative defined cost, active weight cost unit,
and positive finite conversion factor are offered. Existing enum types are fruit, vegetable,
pulp and other. A mix must have one type and one organic status. Product recipe min/max limits
are deliberately not inherited. Percentages have two decimal places and sum exactly to 100.00.
Nonmixable materials are excluded even when they would be used alone.

Configurations come from active complete ProductVariants in the context, active parent Products
and Presentations, positive logistics/weight, active correctly assigned Packaging and valid
consumption rules. Every alternative group must have exactly one default. No ProductIngredient
or Product.additionalCostPerUnit is inherited. Materials remain tied to variant associations.
Fixed rows apply automatically; choices are association IDs per level, one per group.

There is no reliable Packaging ownership/exclusivity relation to a customer/brand. Product.clientId
does not prove that its Packaging is exclusive. No name heuristics are used. Therefore existing
variant materials, including commercially branded materials, can appear until an explicit
ownership/eligibility policy is represented in structured catalog data.

## Identity and calculation

The SHA-256 configuration fingerprint includes its version, subcategory context, presentation ID,
normalized net weight, units/box, boxes/pallet, intermediate units, and sorted complete material
sets: level, Packaging ID, structural group identity (ID, otherwise legacy normalized text),
default, quantity basis/value, and current material cost. SKU, translated names and association
row IDs do not define equivalence. The first variant by ID is the representative of an equivalent
set, and its own association IDs are used for selection. Different group identities are retained.

The orquestator reuses quoteCostLines and quoteMaterialSelection. No formulas were duplicated.
Units = pallets × boxes/pallet × units/box. Raw percentages use the net weight and cost unit
conversion. Intermediate packaging uses the shared ceil rule. Pallet consumption uses per_box
or per_pallet. General per_weight/percentage processing costs remain shared. No transport selection
is exposed in this version, matching the representative's existing transport-disabled flow.
Money retains the shared four-decimal internal precision; presentation uses existing formatting.

## Preview / confirm

`POST /api/custom-quotes/catalog-preview` accepts only context/configuration IDs, certification,
material type, raw IDs/percentages, association choices and pallets. Strict Zod rejects authored
costs, logistics, ingredients and unknown fields. Returns calculation plus a 30-minute HS256 JWT
using the existing JWT_SECRET, audience catalog-quote-confirm, scoped purpose, authenticated
salesperson, language, normalized input digest and server calculation dependency digest.

`POST /api/custom-quotes/catalog-confirm` accepts `{ input, previewToken, confirmationKey }`.
The backend validates token, owner, language and request. It reloads dependencies and recalculates
in a REPEATABLE READ transaction. Catalog loading and both ProcessingCost queries use the same
transaction. Invalidated configuration/selection or changed calculation dependency returns 409,
without writing a request. The UI invalidates review, refreshes discovery and requires a new preview.
The version includes full offered packaging, selected raw costs/conversions, context, presentation,
resolved quantities/names, general processing costs and totals; changed unselected packaging costs
also invalidate the review. Preview never writes a Product, ProductVariant, Quote or CustomQuote.

Confirmation keys are unique per salesperson. A transaction-scoped PostgreSQL advisory lock
serializes concurrent retries; the database unique index is the final defense. A concurrent
repeatable-read snapshot may predate the first insertion; a unique/serialization conflict is
retried with a fresh transaction (at most three attempts). Existing keys require the same input
digest and return the already stored quote rather than recalculating against current catalog.
This recovery still requires a valid unexpired preview token. A request with an unknown network
outcome can be retried using the same key; keys rotate only when its selections change/new quote.

The transaction represents a consistent catalog revision at confirmation start. Catalog writes
committed after that snapshot do not alter the accepted frozen revision.

## Snapshots and historical administration

configuration.snapshot contains schemaVersion, kind, language, capturedAt, generated commercial
name, category/subcategory IDs/names, certification/type, raw names/percentages/cost units/factors,
grams and quantities, source variant/SKU/fingerprint, calculationVersion, presentation ID/label/
weight, logistics, resolved Packaging with groups/selection origin/consumption/effective quantity/
cost/line totals, order quantities, processing costs, subtotals, currency and total.
Existing configuration and breakdown shapes remain available to shared document/cost readers.
Client responses remove source variant and source SKU fields. Internal trace is available only in
the authenticated admin detail. Admin, PDF and email use persisted configuration/breakdown;
they never recalculate a saved request. Source FK is optional and deletion uses SET NULL; the
frozen source trace survives in the snapshot.

Legacy rows remain readable. Missing subcategory names are null, presentation falls back to the
stored variantLabel, missing transport names are null. Current catalog values are not used to
invent historical values. Admin can still update status only. The ready-made dashboard continues
to query Quote and does not count customQuotes as catalog SKU revenue.

## Schema and deployment

Migration: `docs/catalog-customizable-quote-schema.sql`. Additive columns on customQuotes:
- configurationOrigin VARCHAR(30) NOT NULL DEFAULT legacy_options.
- snapshotVersion SMALLINT NOT NULL DEFAULT 1.
- sourceProductVariantId INTEGER NULL, FK productVariants(id), ON DELETE SET NULL.
- confirmationKey UUID NULL.
- confirmationRequestHash VARCHAR(64) NULL.
- unique index (salespersonId, confirmationKey); source variant index.

No data/table deletions, force sync or production alter sync are required. The SQL is transactional
and idempotent through guarded additions. It takes an advisory deployment lock and table locks for
DDL; apply during an appropriate deployment window. No migration was run against a live database
during implementation.

Exact deployment order:
1. Take a normal database backup and verify the target environment and existing tables.
2. Keep DB_SYNC_ALTER=false. Do not start dev:sync or use force/alter for this deployment.
3. Apply with an authorized PostgreSQL connection:
   `psql --dbname="$DATABASE_URL" --set=ON_ERROR_STOP=1 --file=docs/catalog-customizable-quote-schema.sql`
   In PowerShell use `$env:DATABASE_URL` in place of `$DATABASE_URL`; never print the value.
4. Verify columns/indexes/FK via information_schema/pg_indexes. Check historical rows remain.
5. Deploy backend (existing JWT_SECRET and PostgreSQL required, no new secrets/dependencies).
6. Deploy frontend; clear old application assets normally.
7. Smoke-test discovery, preview, confirm, admin and PDF before opening the workflow broadly.

Rollback: redeploy the previous frontend/backend with production schema alteration disabled.
Leave additive columns/indexes and all saved snapshots in place. Do not drop new requests or
rewrite snapshots. Older admin readers may not display all new snapshot fields; restore the new
reader when investigating those requests. Keep schema additions for a subsequent forward fix.

## Validation and manual test

Backend: `node node_modules/jest/bin/jest.js --runInBand --coverage=false`,
`node node_modules/typescript/bin/tsc --noEmit`, `npm run build`.
Frontend: `npm test`, `node scripts/catalog-quote.test.cjs`,
`node scripts/quote-pdf-packaging.test.cjs`, `npm run lint`, `npm run build`.
The frontend PDF test generates confirmed-style customized and ready-made fixture PDFs.
No real email is sent by tests. There is no backend lint script/ESLint configuration to introduce.

Manual steps after schema/backend/frontend deployment:
1. Sign in as a salesperson. Open /solicitud; verify exactly two options.
2. Complete a known Ready-made quote and compare its packaging/defaults/total/PDF.
3. Choose Customize; select context, material type and certification. Only matching raw materials
   should appear. Change type/certification and verify previous composition/configuration resets.
4. Enter a mix totaling 99.99%, then 100.01%: continuation must remain disabled. Enter 100.00%.
5. Choose configurations with identical presentation but different pallet/packaging rules; they
   must remain distinct. Select an alternative, change configuration and verify selection resets.
6. Choose pallets, request review. Verify mix, certification, presentation, packaging and total.
7. In a second admin session change a used raw cost/material default; confirm must report conflict
   and require a fresh review. Restore intended catalog values using the normal admin workflow.
8. Confirm, retry/double-click, and check only one customQuotes row exists for the key.
9. Download/send the confirmed PDF; verify no source product/SKU/internal ID appears.
10. Open /admin/custom-quotes and its detail. Verify the frozen mix/logistics/packaging/costs and
    separated internal audit trace. Rename catalog values: reopening must retain frozen values.
11. Open a legacy request; inspect composition/status/costs and controlled missing context values.

Automated coverage includes discovery/deduplication, fingerprint invariants, exact mix boundaries,
organic/type/nonmixable rejection, strict requests, fixed/default/alternative/intermediate consumption,
changed dependency conflicts, signed-token scope, snapshot immutability, retries, HTTP auth/contracts,
frontend resets/precision/packaging/API errors/document mapping and existing Ready-made regressions.
Real PostgreSQL locking/DDL and email delivery require the deployment smoke tests above.
